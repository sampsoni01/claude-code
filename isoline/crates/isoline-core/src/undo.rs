//! Undo/redo as a command stack of sparse per-tile deltas.
//!
//! Entries beyond a RAM budget are spilled to files in a session-private
//! directory and reloaded on demand, so history depth is bounded by disk.

use crate::field::{ScalarField, TILE_TEXELS};
use crate::hydrology::River;
use crate::placement::Placement;
use crate::water::LakePolygon;
use std::collections::VecDeque;
use std::fs;
use std::io::{self, Read, Write};
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct TileDelta {
    pub tile: u32,
    pub before: Box<[f32]>,
    pub after: Box<[f32]>,
}

impl TileDelta {
    pub fn bytes(&self) -> usize {
        4 + (self.before.len() + self.after.len()) * 4
    }
}

/// Rivers and lakes as one value (user-owned once baked).
#[derive(Clone, Debug)]
pub struct GeometrySnapshot {
    pub rivers: Vec<River>,
    pub lakes: Vec<LakePolygon>,
}

impl GeometrySnapshot {
    pub fn bytes(&self) -> usize {
        self.rivers.iter().map(|r| r.points.len() * 12 + 32).sum::<usize>() + self.lakes.iter().map(|l| l.polygon.points.len() * 8 + 16).sum::<usize>()
    }
}

/// Only user-edited data is recorded: fields the user paints, settings the
/// user changes, geometry the user owns. Derived water and climate fields
/// are recomputed, never stored here.
#[derive(Clone, Debug)]
pub enum UndoOp {
    FieldTiles { field: String, deltas: Vec<TileDelta> },
    SeaLevel { before: f32, after: f32 },
    Geometry { before: GeometrySnapshot, after: GeometrySnapshot },
    Bake {
        baked_before: Option<GeometrySnapshot>,
        moisture_before: Option<ScalarField>,
        baked_after: Option<GeometrySnapshot>,
        moisture_after: Option<ScalarField>,
    },
    /// Manual symbol placements (whole list, small).
    Placements { before: Vec<Placement>, after: Vec<Placement> },
}

impl UndoOp {
    fn bytes(&self) -> usize {
        match self {
            UndoOp::FieldTiles { deltas, .. } => deltas.iter().map(TileDelta::bytes).sum(),
            UndoOp::SeaLevel { .. } => 8,
            UndoOp::Geometry { before, after } => before.bytes() + after.bytes(),
            UndoOp::Placements { before, after } => (before.len() + after.len()) * 64,
            UndoOp::Bake { baked_before, moisture_before, baked_after, moisture_after } => {
                baked_before.as_ref().map(|g| g.bytes()).unwrap_or(0)
                    + baked_after.as_ref().map(|g| g.bytes()).unwrap_or(0)
                    + moisture_before.as_ref().map(|m| m.byte_len()).unwrap_or(0)
                    + moisture_after.as_ref().map(|m| m.byte_len()).unwrap_or(0)
            }
        }
    }
}

#[derive(Debug)]
enum Payload {
    Loaded(UndoOp),
    Spilled { path: PathBuf, field: String, bytes: usize },
}

#[derive(Debug)]
pub struct UndoEntry {
    pub label: String,
    payload: Payload,
}

impl UndoEntry {
    pub fn op(&self) -> Option<&UndoOp> {
        match &self.payload {
            Payload::Loaded(op) => Some(op),
            Payload::Spilled { .. } => None,
        }
    }
}

pub struct UndoStack {
    entries: VecDeque<UndoEntry>,
    /// Number of entries currently applied (entries[..cursor] are undoable).
    cursor: usize,
    ram_budget: usize,
    loaded_bytes: usize,
    spill_dir: PathBuf,
    seq: u64,
    max_entries: usize,
}

impl UndoStack {
    /// `ram_budget` is the number of bytes of loaded history to keep in memory.
    pub fn new(ram_budget: usize) -> Self {
        let spill_dir = std::env::temp_dir().join(format!("isoline-undo-{}", std::process::id()));
        Self {
            entries: VecDeque::new(),
            cursor: 0,
            ram_budget,
            loaded_bytes: 0,
            spill_dir,
            seq: 0,
            max_entries: 10_000,
        }
    }

    pub fn ram_budget(&self) -> usize {
        self.ram_budget
    }
    pub fn set_ram_budget(&mut self, bytes: usize) {
        self.ram_budget = bytes;
        self.enforce_budget();
    }
    pub fn loaded_bytes(&self) -> usize {
        self.loaded_bytes
    }
    pub fn spilled_bytes(&self) -> usize {
        self.entries
            .iter()
            .map(|e| match &e.payload {
                Payload::Spilled { bytes, .. } => *bytes,
                _ => 0,
            })
            .sum()
    }
    pub fn can_undo(&self) -> bool {
        self.cursor > 0
    }
    pub fn can_redo(&self) -> bool {
        self.cursor < self.entries.len()
    }
    pub fn undo_label(&self) -> Option<&str> {
        self.cursor.checked_sub(1).map(|i| self.entries[i].label.as_str())
    }
    pub fn redo_label(&self) -> Option<&str> {
        self.entries.get(self.cursor).map(|e| e.label.as_str())
    }
    pub fn len(&self) -> usize {
        self.entries.len()
    }
    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn push(&mut self, label: impl Into<String>, op: UndoOp) {
        // Drop the redo branch.
        while self.entries.len() > self.cursor {
            let e = self.entries.pop_back().unwrap();
            self.discard(e);
        }
        self.loaded_bytes += op.bytes();
        self.entries.push_back(UndoEntry { label: label.into(), payload: Payload::Loaded(op) });
        self.cursor = self.entries.len();
        while self.entries.len() > self.max_entries {
            let e = self.entries.pop_front().unwrap();
            self.cursor -= 1;
            self.discard(e);
        }
        self.enforce_budget();
    }

    /// Step back. Returns the op to *revert* (apply its `before` state).
    pub fn undo(&mut self) -> Option<&UndoOp> {
        if self.cursor == 0 {
            return None;
        }
        self.cursor -= 1;
        let i = self.cursor;
        self.ensure_loaded(i);
        self.entries[i].op()
    }

    /// Step forward. Returns the op to *re-apply* (apply its `after` state).
    pub fn redo(&mut self) -> Option<&UndoOp> {
        if self.cursor >= self.entries.len() {
            return None;
        }
        let i = self.cursor;
        self.cursor += 1;
        self.ensure_loaded(i);
        self.entries[i].op()
    }

    fn discard(&mut self, e: UndoEntry) {
        match e.payload {
            Payload::Loaded(op) => self.loaded_bytes -= op.bytes(),
            Payload::Spilled { path, .. } => {
                let _ = fs::remove_file(path);
            }
        }
    }

    /// Spill the oldest loaded entries until we fit the budget, keeping the
    /// two entries nearest the cursor resident so a quick undo never touches disk.
    fn enforce_budget(&mut self) {
        if self.loaded_bytes <= self.ram_budget {
            return;
        }
        let keep_from = self.cursor.saturating_sub(2);
        for i in 0..keep_from {
            if self.loaded_bytes <= self.ram_budget {
                break;
            }
            if let Payload::Loaded(UndoOp::FieldTiles { .. }) = &self.entries[i].payload {
                if let Err(err) = self.spill(i) {
                    log::warn!("undo spill failed: {err}");
                    break;
                }
            }
        }
    }

    fn spill(&mut self, i: usize) -> io::Result<()> {
        fs::create_dir_all(&self.spill_dir)?;
        self.seq += 1;
        let path = self.spill_dir.join(format!("{:08}.undo", self.seq));
        let entry = &mut self.entries[i];
        let Payload::Loaded(UndoOp::FieldTiles { field, deltas }) = &entry.payload else { return Ok(()) };
        let bytes: usize = deltas.iter().map(TileDelta::bytes).sum();
        let mut f = io::BufWriter::new(fs::File::create(&path)?);
        f.write_all(&(deltas.len() as u32).to_le_bytes())?;
        for d in deltas {
            f.write_all(&d.tile.to_le_bytes())?;
            f.write_all(bytemuck::cast_slice(&d.before))?;
            f.write_all(bytemuck::cast_slice(&d.after))?;
        }
        f.flush()?;
        let field = field.clone();
        entry.payload = Payload::Spilled { path, field, bytes };
        self.loaded_bytes -= bytes;
        Ok(())
    }

    fn ensure_loaded(&mut self, i: usize) {
        let Payload::Spilled { path, field, bytes } = &self.entries[i].payload else { return };
        let (path, field, bytes) = (path.clone(), field.clone(), *bytes);
        match Self::read_spilled(&path) {
            Ok(deltas) => {
                let _ = fs::remove_file(&path);
                self.entries[i].payload = Payload::Loaded(UndoOp::FieldTiles { field, deltas });
                self.loaded_bytes += bytes;
                // Loading one may push another out.
                let saved_cursor = self.cursor;
                self.cursor = i + 1;
                self.enforce_budget();
                self.cursor = saved_cursor;
            }
            Err(err) => {
                log::error!("failed to reload spilled undo entry {}: {err}", path.display());
            }
        }
    }

    fn read_spilled(path: &PathBuf) -> io::Result<Vec<TileDelta>> {
        let mut f = io::BufReader::new(fs::File::open(path)?);
        let mut n = [0u8; 4];
        f.read_exact(&mut n)?;
        let n = u32::from_le_bytes(n) as usize;
        let mut out = Vec::with_capacity(n);
        for _ in 0..n {
            let mut t = [0u8; 4];
            f.read_exact(&mut t)?;
            let mut before = vec![0f32; TILE_TEXELS].into_boxed_slice();
            let mut after = vec![0f32; TILE_TEXELS].into_boxed_slice();
            f.read_exact(bytemuck::cast_slice_mut(&mut before))?;
            f.read_exact(bytemuck::cast_slice_mut(&mut after))?;
            out.push(TileDelta { tile: u32::from_le_bytes(t), before, after });
        }
        Ok(out)
    }
}

impl Drop for UndoStack {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.spill_dir);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn delta(tile: u32, v: f32) -> TileDelta {
        TileDelta {
            tile,
            before: vec![v; TILE_TEXELS].into_boxed_slice(),
            after: vec![v + 1.0; TILE_TEXELS].into_boxed_slice(),
        }
    }

    #[test]
    fn spill_and_reload_round_trip() {
        // Budget fits ~2 entries of one tile each.
        let mut s = UndoStack::new(2 * (4 + TILE_TEXELS * 8) + 16);
        for i in 0..5 {
            s.push(format!("stroke {i}"), UndoOp::FieldTiles { field: "elevation".into(), deltas: vec![delta(i, i as f32)] });
        }
        assert!(s.spilled_bytes() > 0, "expected some entries to spill");
        assert!(s.loaded_bytes() <= s.ram_budget());
        // Undo all the way back; the spilled ones must reload correctly.
        for expect in (0..5).rev() {
            let op = s.undo().expect("undo");
            match op {
                UndoOp::FieldTiles { deltas, .. } => {
                    assert_eq!(deltas[0].tile, expect);
                    assert_eq!(deltas[0].before[0], expect as f32);
                    assert_eq!(deltas[0].after[7], expect as f32 + 1.0);
                }
                _ => panic!(),
            }
        }
        assert!(!s.can_undo());
        assert!(s.redo().is_some());
        assert_eq!(s.undo_label(), Some("stroke 0"));
    }

    #[test]
    fn push_truncates_redo() {
        let mut s = UndoStack::new(1 << 20);
        s.push("a", UndoOp::SeaLevel { before: 0.0, after: 1.0 });
        s.push("b", UndoOp::SeaLevel { before: 1.0, after: 2.0 });
        s.undo();
        s.push("c", UndoOp::SeaLevel { before: 1.0, after: 3.0 });
        assert!(!s.can_redo());
        assert_eq!(s.len(), 2);
        assert_eq!(s.undo_label(), Some("c"));
    }
}
