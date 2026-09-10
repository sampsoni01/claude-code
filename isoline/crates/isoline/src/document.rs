//! The open map: fields, settings, dependency graph, derived data and undo.

use anyhow::Result;
use isoline_core::field::ScalarField;
use isoline_core::graph::{DepGraph, Edge, NodeId, Reach};
use isoline_core::project::{Manifest, ProjectData, RenderSettings, ViewState};
use isoline_core::stats::FieldStats;
use isoline_core::tiles::{PixelRect, TileSet};
use isoline_core::undo::{TileDelta, UndoOp, UndoStack};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Instant;

/// Graph node handles for the Milestone 1 graph.
#[derive(Clone, Copy, Debug)]
pub struct Nodes {
    pub elevation: NodeId,
    pub sea_level: NodeId,
    /// GPU-live: the map shader derives it every frame from `elevation`.
    pub hillshade: NodeId,
    /// GPU-live: the sea-level isoline, from `elevation` and `sea_level`.
    pub coast: NodeId,
    /// CPU: incremental per-tile statistics.
    pub stats: NodeId,
}

struct StrokeRecord {
    label: String,
    before: HashMap<u32, Box<[f32]>>,
}

pub struct Document {
    pub name: String,
    pub path: Option<PathBuf>,
    pub elevation: ScalarField,
    pub sea_level: f32,
    pub meters_per_texel: f32,
    pub render: RenderSettings,
    pub saved_view: ViewState,
    pub graph: DepGraph,
    pub nodes: Nodes,
    pub stats: FieldStats,
    pub undo: UndoStack,
    pub modified: bool,
    /// Tiles the GPU has written that the CPU mirror has not yet received.
    pub pending_readback: TileSet,
    stroke: Option<StrokeRecord>,
    finishing: Vec<StrokeRecord>,
    pub last_autosave: Instant,
    /// Wall time of the last derived-data update, for the profiler.
    pub last_derived_ms: f32,
}

pub const UNDO_RAM_BUDGET: usize = 512 << 20;

fn build_graph(width: u32, height: u32) -> (DepGraph, Nodes) {
    let mut g = DepGraph::new(width, height);
    let elevation = g.add_node("elevation", vec![]);
    let sea_level = g.add_node("sea_level", vec![]);
    let hillshade = g.add_node("hillshade", vec![Edge { from: elevation, reach: Reach::Local(1) }]);
    let coast = g.add_node(
        "coastline",
        vec![Edge { from: elevation, reach: Reach::Local(1) }, Edge { from: sea_level, reach: Reach::Global }],
    );
    let stats = g.add_node(
        "stats",
        vec![Edge { from: elevation, reach: Reach::Local(0) }, Edge { from: sea_level, reach: Reach::Global }],
    );
    (g, Nodes { elevation, sea_level, hillshade, coast, stats })
}

impl Document {
    pub fn new(name: impl Into<String>, elevation: ScalarField, sea_level: f32, meters_per_texel: f32) -> Self {
        let (graph, nodes) = build_graph(elevation.width(), elevation.height());
        let stats = FieldStats::new(&elevation, sea_level);
        let pending = elevation.empty_tileset();
        let w = elevation.width() as f32;
        let h = elevation.height() as f32;
        Self {
            name: name.into(),
            path: None,
            elevation,
            sea_level,
            meters_per_texel,
            render: RenderSettings::default(),
            saved_view: ViewState { center: [w / 2.0, h / 2.0], zoom: 0.0 },
            graph,
            nodes,
            stats,
            undo: UndoStack::new(UNDO_RAM_BUDGET),
            modified: false,
            pending_readback: pending,
            stroke: None,
            finishing: Vec::new(),
            last_autosave: Instant::now(),
            last_derived_ms: 0.0,
        }
    }

    pub fn from_project(data: ProjectData, path: Option<PathBuf>) -> Result<Self> {
        let ProjectData { manifest, fields } = data;
        let (_, elevation) = fields
            .into_iter()
            .find(|(n, _)| n == "elevation")
            .ok_or_else(|| anyhow::anyhow!("project has no elevation field"))?;
        let mut doc = Self::new(manifest.name.clone(), elevation, manifest.sea_level, manifest.meters_per_texel);
        doc.render = manifest.render;
        doc.saved_view = manifest.view;
        doc.path = path;
        Ok(doc)
    }

    pub fn to_project_data(&self, view: ViewState) -> ProjectData {
        let mut m = Manifest::new(&self.name, self.elevation.width(), self.elevation.height());
        m.sea_level = self.sea_level;
        m.meters_per_texel = self.meters_per_texel;
        m.render = self.render.clone();
        m.view = view;
        ProjectData { manifest: m, fields: vec![("elevation".into(), self.elevation.clone())] }
    }

    pub fn width(&self) -> u32 {
        self.elevation.width()
    }
    pub fn height(&self) -> u32 {
        self.elevation.height()
    }

    // ---- strokes & undo ----------------------------------------------------

    /// Start recording a stroke. The CPU mirror must be current (flush first).
    pub fn begin_stroke(&mut self, label: impl Into<String>) {
        if let Some(s) = self.stroke.take() {
            self.finishing.push(s);
        }
        self.stroke = Some(StrokeRecord { label: label.into(), before: HashMap::new() });
    }

    /// Snapshot the pre-edit contents of tiles under `rect` that this stroke
    /// has not touched yet. Call before the GPU writes them.
    pub fn stroke_will_touch(&mut self, rect: &PixelRect) {
        let Some(s) = self.stroke.as_mut() else { return };
        let mut ts = self.elevation.empty_tileset();
        ts.insert_rect(rect);
        for t in ts.iter_indices() {
            s.before.entry(t).or_insert_with(|| self.elevation.read_tile_boxed(t));
        }
    }

    pub fn end_stroke(&mut self) {
        if let Some(s) = self.stroke.take() {
            self.finishing.push(s);
        }
    }

    /// Once every readback has landed, capture the post-stroke tiles and push
    /// the undo entries. Returns the number of strokes finalized.
    pub fn try_finalize_strokes(&mut self, readback_in_flight: bool) -> usize {
        if self.finishing.is_empty() || readback_in_flight || !self.pending_readback.is_empty() {
            return 0;
        }
        let mut n = 0;
        for s in self.finishing.drain(..) {
            let mut deltas: Vec<TileDelta> = s
                .before
                .into_iter()
                .map(|(tile, before)| {
                    let after = self.elevation.read_tile_boxed(tile);
                    TileDelta { tile, before, after }
                })
                .filter(|d| d.before != d.after)
                .collect();
            if deltas.is_empty() {
                continue;
            }
            deltas.sort_by_key(|d| d.tile);
            self.undo.push(s.label, UndoOp::FieldTiles { field: "elevation".into(), deltas });
            n += 1;
        }
        n
    }

    /// Tiles whose mirror just received GPU results.
    pub fn on_tiles_landed(&mut self, tiles: &[u32]) {
        let mut ts = self.elevation.empty_tileset();
        for &t in tiles {
            ts.insert_index(t);
        }
        self.graph.mark_dirty(self.nodes.elevation, &ts);
        self.recompute_derived();
    }

    /// Apply an undo op to the mirror. Returns tiles the caller must upload.
    fn apply_op(&mut self, op: &UndoOp, forward: bool) -> Vec<u32> {
        match op {
            UndoOp::FieldTiles { deltas, .. } => {
                let mut ts = self.elevation.empty_tileset();
                let mut tiles = Vec::with_capacity(deltas.len());
                for d in deltas {
                    let src = if forward { &d.after } else { &d.before };
                    self.elevation.write_tile(d.tile, src);
                    ts.insert_index(d.tile);
                    tiles.push(d.tile);
                }
                self.graph.mark_dirty(self.nodes.elevation, &ts);
                self.modified = true;
                tiles
            }
            UndoOp::SeaLevel { before, after } => {
                self.sea_level = if forward { *after } else { *before };
                self.graph.mark_all_dirty(self.nodes.sea_level);
                self.modified = true;
                Vec::new()
            }
        }
    }

    pub fn undo(&mut self) -> Option<Vec<u32>> {
        let op = self.undo.undo()?.clone();
        let tiles = self.apply_op(&op, false);
        self.recompute_derived();
        Some(tiles)
    }

    pub fn redo(&mut self) -> Option<Vec<u32>> {
        let op = self.undo.redo()?.clone();
        let tiles = self.apply_op(&op, true);
        self.recompute_derived();
        Some(tiles)
    }

    // ---- settings ----------------------------------------------------------

    /// Live sea-level change (while dragging). No undo entry.
    pub fn set_sea_level_live(&mut self, v: f32) {
        if v != self.sea_level {
            self.sea_level = v;
            self.graph.mark_all_dirty(self.nodes.sea_level);
            self.modified = true;
            self.recompute_derived();
        }
    }

    /// Commit a finished sea-level drag as one undo entry.
    pub fn commit_sea_level(&mut self, from: f32, to: f32) {
        if from != to {
            self.undo.push("Sea level", UndoOp::SeaLevel { before: from, after: to });
        }
    }

    // ---- derived data ------------------------------------------------------

    /// Propagate dirtiness and recompute CPU-side derived nodes. GPU-live
    /// nodes are cleared here because the next frame re-derives them.
    pub fn recompute_derived(&mut self) {
        let t = Instant::now();
        self.graph.propagate();
        let dirty = self.graph.take_dirty(self.nodes.stats);
        if !dirty.is_empty() {
            self.stats.update(&self.elevation, &dirty, self.sea_level);
        }
        self.graph.clear_dirty(self.nodes.hillshade);
        self.graph.clear_dirty(self.nodes.coast);
        self.graph.clear_dirty(self.nodes.elevation);
        self.graph.clear_dirty(self.nodes.sea_level);
        self.last_derived_ms = t.elapsed().as_secs_f32() * 1000.0;
    }
}
