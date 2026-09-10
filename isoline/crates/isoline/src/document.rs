//! The open map: fields, settings, dependency graph, derived data and undo.

use anyhow::Result;
use isoline_core::derived::{BakedWater, Derived, DerivedParams};
use isoline_core::entity::Entity;
use isoline_core::field::ScalarField;
use isoline_core::graph::{DepGraph, Edge, NodeId, Reach};
use isoline_core::placement::Placement;
use isoline_core::project::{Geometry, Manifest, ProjectData, RenderSettings, SymbolParams, ViewState};
use isoline_core::stats::FieldStats;
use isoline_core::tiles::{PixelRect, TileSet};
use isoline_core::undo::{GeometrySnapshot, TileDelta, UndoOp, UndoStack};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Instant;

/// Graph node handles.
#[derive(Clone, Copy, Debug)]
pub struct Nodes {
    pub elevation: NodeId,
    pub sea_level: NodeId,
    pub hillshade: NodeId,
    pub coast: NodeId,
    pub stats: NodeId,
    pub settings: NodeId,
    /// User-owned baked water (geometry + moisture field).
    pub baked_water: NodeId,
    /// CPU job: water → temperature → biomes.
    pub derived: NodeId,
}

/// The user-editable fields a brush can paint into.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FieldKind {
    Elevation,
    /// Only exists once water is baked.
    Moisture,
}

impl FieldKind {
    pub fn name(self) -> &'static str {
        match self {
            FieldKind::Elevation => "elevation",
            FieldKind::Moisture => "moisture",
        }
    }
    pub fn from_name(n: &str) -> Option<FieldKind> {
        match n {
            "elevation" => Some(FieldKind::Elevation),
            "moisture" => Some(FieldKind::Moisture),
            _ => None,
        }
    }
}

struct StrokeRecord {
    label: String,
    field: FieldKind,
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
    pending_readback: HashMap<FieldKind, TileSet>,
    stroke: Option<StrokeRecord>,
    finishing: Vec<StrokeRecord>,
    pub last_autosave: Instant,
    pub last_derived_ms: f32,
    pub params: DerivedParams,
    pub derived: Option<Derived>,
    pub derived_stale: bool,
    pub derived_last_change: Instant,
    /// Set by "Recompute water"; consumed by the scheduler.
    pub derived_requested: bool,
    pub baked: Option<BakedWater>,
    /// Number of derived results that landed (for the profiler / status).
    pub derived_runs: u64,
    /// User-placed symbols (persisted).
    pub placements: Vec<Placement>,
    /// Automatic symbol layers (regenerated).
    pub auto_symbols: Vec<Placement>,
    pub symbols: SymbolParams,
    pub symbols_stale: bool,
    pub next_placement_id: u64,
    pub entities: Vec<Entity>,
    pub next_entity_id: u64,
    pub culture: String,
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
    let settings = g.add_node("settings", vec![]);
    let baked_water = g.add_node("baked_water", vec![]);
    let derived = g.add_node(
        "derived",
        vec![
            Edge { from: elevation, reach: Reach::Global },
            Edge { from: sea_level, reach: Reach::Global },
            Edge { from: settings, reach: Reach::Global },
            Edge { from: baked_water, reach: Reach::Global },
        ],
    );
    (g, Nodes { elevation, sea_level, hillshade, coast, stats, settings, baked_water, derived })
}

impl Document {
    pub fn new(name: impl Into<String>, elevation: ScalarField, sea_level: f32, meters_per_texel: f32) -> Self {
        let (graph, nodes) = build_graph(elevation.width(), elevation.height());
        let stats = FieldStats::new(&elevation, sea_level);
        let mut pending = HashMap::new();
        pending.insert(FieldKind::Elevation, elevation.empty_tileset());
        pending.insert(FieldKind::Moisture, elevation.empty_tileset());
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
            params: DerivedParams::default(),
            derived: None,
            derived_stale: true,
            derived_last_change: Instant::now(),
            derived_requested: false,
            baked: None,
            derived_runs: 0,
            placements: Vec::new(),
            auto_symbols: Vec::new(),
            symbols: SymbolParams::default(),
            symbols_stale: true,
            next_placement_id: 1,
            entities: Vec::new(),
            next_entity_id: 1,
            culture: "northern".into(),
        }
    }

    pub fn from_project(data: ProjectData, path: Option<PathBuf>) -> Result<Self> {
        let ProjectData { manifest, fields, geometry } = data;
        let mut elevation = None;
        let mut moisture = None;
        for (n, f) in fields {
            match n.as_str() {
                "elevation" => elevation = Some(f),
                "moisture" => moisture = Some(f),
                _ => {}
            }
        }
        let elevation = elevation.ok_or_else(|| anyhow::anyhow!("project has no elevation field"))?;
        let mut doc = Self::new(manifest.name.clone(), elevation, manifest.sea_level, manifest.meters_per_texel);
        doc.render = manifest.render;
        doc.saved_view = manifest.view;
        doc.params = manifest.derived;
        doc.symbols = manifest.symbols;
        doc.placements = geometry.placements.clone();
        doc.next_placement_id = doc.placements.iter().map(|p| p.id).max().unwrap_or(0) + 1;
        doc.entities = geometry.entities.clone();
        doc.next_entity_id = doc.entities.iter().map(|e| e.id).max().unwrap_or(0) + 1;
        doc.culture = manifest.culture.clone();
        doc.path = path;
        if geometry.baked {
            let moisture = moisture.unwrap_or_else(|| ScalarField::new(doc.width(), doc.height(), 0.5));
            doc.baked = Some(BakedWater { rivers: geometry.rivers, lakes: geometry.lakes, moisture });
        }
        Ok(doc)
    }

    pub fn to_project_data(&self, view: ViewState) -> ProjectData {
        let mut m = Manifest::new(&self.name, self.elevation.width(), self.elevation.height());
        m.sea_level = self.sea_level;
        m.meters_per_texel = self.meters_per_texel;
        m.render = self.render.clone();
        m.view = view;
        m.derived = self.params.clone();
        m.symbols = self.symbols.clone();
        m.culture = self.culture.clone();
        let mut fields = vec![("elevation".to_string(), self.elevation.clone())];
        let mut geometry = match (&self.baked, &self.derived) {
            (Some(b), _) => {
                fields.push(("moisture".into(), b.moisture.clone()));
                Geometry { rivers: b.rivers.clone(), lakes: b.lakes.clone(), baked: true, placements: Vec::new(), entities: Vec::new() }
            }
            (None, Some(d)) => Geometry { rivers: d.water.rivers.clone(), lakes: d.water.lakes.clone(), baked: false, placements: Vec::new(), entities: Vec::new() },
            _ => Geometry::default(),
        };
        geometry.placements = self.placements.clone();
        geometry.entities = self.entities.clone();
        ProjectData { manifest: m, fields, geometry }
    }

    pub fn width(&self) -> u32 {
        self.elevation.width()
    }
    pub fn height(&self) -> u32 {
        self.elevation.height()
    }

    pub fn field(&self, kind: FieldKind) -> Option<&ScalarField> {
        match kind {
            FieldKind::Elevation => Some(&self.elevation),
            FieldKind::Moisture => self.baked.as_ref().map(|b| &b.moisture),
        }
    }

    pub fn field_mut(&mut self, kind: FieldKind) -> Option<&mut ScalarField> {
        match kind {
            FieldKind::Elevation => Some(&mut self.elevation),
            FieldKind::Moisture => self.baked.as_mut().map(|b| &mut b.moisture),
        }
    }

    #[allow(dead_code)]
    pub fn pending_readback(&self, kind: FieldKind) -> &TileSet {
        &self.pending_readback[&kind]
    }
    pub fn pending_readback_mut(&mut self, kind: FieldKind) -> &mut TileSet {
        self.pending_readback.get_mut(&kind).unwrap()
    }
    pub fn any_pending_readback(&self) -> bool {
        self.pending_readback.values().any(|t| !t.is_empty())
    }

    // ---- strokes & undo ----------------------------------------------------

    pub fn begin_stroke(&mut self, label: impl Into<String>, field: FieldKind) {
        if let Some(s) = self.stroke.take() {
            self.finishing.push(s);
        }
        self.stroke = Some(StrokeRecord { label: label.into(), field, before: HashMap::new() });
    }

    pub fn stroke_field(&self) -> Option<FieldKind> {
        self.stroke.as_ref().map(|s| s.field)
    }

    /// Snapshot pre-edit tiles under `rect` for the active stroke.
    pub fn stroke_will_touch(&mut self, rect: &PixelRect) {
        let Some(s) = self.stroke.as_mut() else { return };
        let field = match s.field {
            FieldKind::Elevation => &self.elevation,
            FieldKind::Moisture => match self.baked.as_ref() {
                Some(b) => &b.moisture,
                None => return,
            },
        };
        let mut ts = field.empty_tileset();
        ts.insert_rect(rect);
        for t in ts.iter_indices() {
            s.before.entry(t).or_insert_with(|| field.read_tile_boxed(t));
        }
    }

    pub fn end_stroke(&mut self) {
        if let Some(s) = self.stroke.take() {
            self.finishing.push(s);
        }
    }

    /// Once every readback has landed, capture post-stroke tiles and push undo.
    pub fn try_finalize_strokes(&mut self, readback_in_flight: bool) -> usize {
        if self.finishing.is_empty() || readback_in_flight || self.any_pending_readback() {
            return 0;
        }
        let mut n = 0;
        let finishing = std::mem::take(&mut self.finishing);
        for s in finishing {
            let Some(field) = self.field(s.field) else { continue };
            let mut deltas: Vec<TileDelta> = s
                .before
                .into_iter()
                .map(|(tile, before)| {
                    let after = field.read_tile_boxed(tile);
                    TileDelta { tile, before, after }
                })
                .filter(|d| d.before != d.after)
                .collect();
            if deltas.is_empty() {
                continue;
            }
            deltas.sort_by_key(|d| d.tile);
            self.undo.push(s.label, UndoOp::FieldTiles { field: s.field.name().into(), deltas });
            n += 1;
        }
        n
    }

    /// A CPU-side edit of a field over `rect` (procedural brushes): snapshot,
    /// apply, push one undo entry, return the tiles to upload.
    pub fn apply_cpu_edit(&mut self, label: &str, kind: FieldKind, rect: &PixelRect, edit: impl FnOnce(&mut ScalarField)) -> Vec<u32> {
        let Some(field) = self.field_mut(kind) else { return Vec::new() };
        let mut ts = field.empty_tileset();
        ts.insert_rect(rect);
        let tiles: Vec<u32> = ts.iter_indices().collect();
        let before: Vec<Box<[f32]>> = tiles.iter().map(|&t| field.read_tile_boxed(t)).collect();
        edit(field);
        let mut deltas = Vec::new();
        let mut changed = Vec::new();
        for (i, &t) in tiles.iter().enumerate() {
            let after = field.read_tile_boxed(t);
            if after != before[i] {
                deltas.push(TileDelta { tile: t, before: before[i].clone(), after });
                changed.push(t);
            }
        }
        if !deltas.is_empty() {
            self.undo.push(label, UndoOp::FieldTiles { field: kind.name().into(), deltas });
            self.modified = true;
            self.mark_field_tiles(kind, &changed);
        }
        changed
    }

    fn mark_field_tiles(&mut self, kind: FieldKind, tiles: &[u32]) {
        let mut ts = self.elevation.empty_tileset();
        for &t in tiles {
            ts.insert_index(t);
        }
        match kind {
            FieldKind::Elevation => self.graph.mark_dirty(self.nodes.elevation, &ts),
            FieldKind::Moisture => self.graph.mark_all_dirty(self.nodes.baked_water),
        }
        self.recompute_derived();
    }

    /// Tiles whose mirror just received GPU results.
    pub fn on_tiles_landed(&mut self, kind: FieldKind, tiles: &[u32]) {
        self.mark_field_tiles(kind, tiles);
    }

    /// Apply an undo op to the mirrors. Returns `(field, tiles)` to upload.
    fn apply_op(&mut self, op: &UndoOp, forward: bool) -> Option<(FieldKind, Vec<u32>)> {
        match op {
            UndoOp::FieldTiles { field, deltas } => {
                let kind = FieldKind::from_name(field)?;
                let f = self.field_mut(kind)?;
                let mut tiles = Vec::with_capacity(deltas.len());
                for d in deltas {
                    let src = if forward { &d.after } else { &d.before };
                    f.write_tile(d.tile, src);
                    tiles.push(d.tile);
                }
                self.modified = true;
                self.mark_field_tiles(kind, &tiles);
                Some((kind, tiles))
            }
            UndoOp::SeaLevel { before, after } => {
                self.sea_level = if forward { *after } else { *before };
                self.graph.mark_all_dirty(self.nodes.sea_level);
                self.modified = true;
                self.recompute_derived();
                None
            }
            UndoOp::Geometry { before, after } => {
                let g = if forward { after } else { before };
                if let Some(b) = self.baked.as_mut() {
                    b.rivers = g.rivers.clone();
                    b.lakes = g.lakes.clone();
                }
                self.graph.mark_all_dirty(self.nodes.baked_water);
                self.modified = true;
                self.recompute_derived();
                None
            }
            UndoOp::Placements { before, after } => {
                self.placements = if forward { after.clone() } else { before.clone() };
                self.modified = true;
                None
            }
            UndoOp::Entities { before, after } => {
                self.entities = if forward { after.clone() } else { before.clone() };
                self.modified = true;
                None
            }
            UndoOp::Bake { baked_before, moisture_before, baked_after, moisture_after } => {
                let (g, m) = if forward { (baked_after, moisture_after) } else { (baked_before, moisture_before) };
                self.baked = match (g, m) {
                    (Some(g), Some(m)) => Some(BakedWater { rivers: g.rivers.clone(), lakes: g.lakes.clone(), moisture: m.clone() }),
                    _ => None,
                };
                self.graph.mark_all_dirty(self.nodes.baked_water);
                self.modified = true;
                self.recompute_derived();
                None
            }
        }
    }

    pub fn undo(&mut self) -> Option<Option<(FieldKind, Vec<u32>)>> {
        let op = self.undo.undo()?.clone();
        Some(self.apply_op(&op, false))
    }

    pub fn redo(&mut self) -> Option<Option<(FieldKind, Vec<u32>)>> {
        let op = self.undo.redo()?.clone();
        Some(self.apply_op(&op, true))
    }

    // ---- settings ----------------------------------------------------------

    pub fn set_sea_level_live(&mut self, v: f32) {
        if v != self.sea_level {
            self.sea_level = v;
            self.graph.mark_all_dirty(self.nodes.sea_level);
            self.modified = true;
            self.recompute_derived();
        }
    }

    pub fn commit_sea_level(&mut self, from: f32, to: f32) {
        if from != to {
            self.undo.push("Sea level", UndoOp::SeaLevel { before: from, after: to });
        }
    }

    pub fn settings_changed(&mut self) {
        self.graph.mark_all_dirty(self.nodes.settings);
        self.modified = true;
        self.recompute_derived();
    }

    // ---- baked water -------------------------------------------------------

    /// Convert the current rivers, lakes and moisture into user-owned data.
    pub fn bake_water(&mut self) -> bool {
        let Some(d) = self.derived.as_ref() else { return false };
        if self.baked.is_some() {
            return false;
        }
        let moisture = match &d.water.moisture {
            Some(m) => m.resample(self.width(), self.height()),
            None => ScalarField::new(self.width(), self.height(), 0.5),
        };
        let baked = BakedWater { rivers: d.water.rivers.clone(), lakes: d.water.lakes.clone(), moisture };
        self.undo.push(
            "Bake water",
            UndoOp::Bake {
                baked_before: None,
                moisture_before: None,
                baked_after: Some(GeometrySnapshot { rivers: baked.rivers.clone(), lakes: baked.lakes.clone() }),
                moisture_after: Some(baked.moisture.clone()),
            },
        );
        self.baked = Some(baked);
        self.graph.mark_all_dirty(self.nodes.baked_water);
        self.modified = true;
        self.recompute_derived();
        true
    }

    pub fn unbake_water(&mut self) -> bool {
        let Some(b) = self.baked.take() else { return false };
        self.undo.push(
            "Unbake water",
            UndoOp::Bake {
                baked_before: Some(GeometrySnapshot { rivers: b.rivers, lakes: b.lakes }),
                moisture_before: Some(b.moisture),
                baked_after: None,
                moisture_after: None,
            },
        );
        self.graph.mark_all_dirty(self.nodes.baked_water);
        self.modified = true;
        self.recompute_derived();
        true
    }

    pub fn geometry_snapshot(&self) -> Option<GeometrySnapshot> {
        self.baked.as_ref().map(|b| GeometrySnapshot { rivers: b.rivers.clone(), lakes: b.lakes.clone() })
    }

    /// Commit an interactive geometry edit as one undo entry.
    pub fn commit_geometry_edit(&mut self, label: &str, before: GeometrySnapshot) {
        let Some(after) = self.geometry_snapshot() else { return };
        if after.rivers == before.rivers && after.lakes == before.lakes {
            return;
        }
        self.undo.push(label, UndoOp::Geometry { before, after });
        self.graph.mark_all_dirty(self.nodes.baked_water);
        self.modified = true;
        self.recompute_derived();
    }

    // ---- symbols -----------------------------------------------------------

    /// Commit a change to the manual placements as one undo entry.
    pub fn commit_placements(&mut self, label: &str, before: Vec<Placement>) {
        if before == self.placements {
            return;
        }
        self.undo.push(label, UndoOp::Placements { before, after: self.placements.clone() });
        self.modified = true;
    }

    pub fn new_placement_id(&mut self) -> u64 {
        let id = self.next_placement_id;
        self.next_placement_id += 1;
        id
    }

    /// Commit a change to the entity list as one undo entry.
    pub fn commit_entities(&mut self, label: &str, before: Vec<Entity>) {
        if before == self.entities {
            return;
        }
        self.undo.push(label, UndoOp::Entities { before, after: self.entities.clone() });
        self.modified = true;
    }

    pub fn entity(&self, id: u64) -> Option<&Entity> {
        self.entities.iter().find(|e| e.id == id)
    }
    pub fn entity_mut(&mut self, id: u64) -> Option<&mut Entity> {
        self.entities.iter_mut().find(|e| e.id == id)
    }

    pub fn symbols_changed(&mut self) {
        self.symbols_stale = true;
        self.modified = true;
    }

    /// All symbols to draw, back to front.
    pub fn all_symbols(&self) -> Vec<&Placement> {
        let mut v: Vec<&Placement> = self.auto_symbols.iter().chain(self.placements.iter()).collect();
        v.sort_by(|a, b| a.pos[1].partial_cmp(&b.pos[1]).unwrap_or(std::cmp::Ordering::Equal));
        v
    }

    // ---- derived data ------------------------------------------------------

    pub fn recompute_derived(&mut self) {
        let t = Instant::now();
        self.graph.propagate();
        let dirty = self.graph.take_dirty(self.nodes.stats);
        if !dirty.is_empty() {
            self.stats.update(&self.elevation, &dirty, self.sea_level);
        }
        if self.graph.is_dirty(self.nodes.derived) {
            self.graph.clear_dirty(self.nodes.derived);
            self.derived_stale = true;
            self.derived_last_change = Instant::now();
            self.symbols_stale = true;
        }
        for n in [self.nodes.hillshade, self.nodes.coast, self.nodes.elevation, self.nodes.sea_level, self.nodes.settings, self.nodes.baked_water] {
            self.graph.clear_dirty(n);
        }
        self.last_derived_ms = t.elapsed().as_secs_f32() * 1000.0;
    }
}

