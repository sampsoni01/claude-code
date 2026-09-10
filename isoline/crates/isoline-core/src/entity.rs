//! Entities: every named or selectable thing on the map, with a label.

use crate::geometry::{Polygon, P2};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum EntityKind {
    Settlement,
    River,
    Lake,
    Range,
    Peak,
    Forest,
    Bay,
    Cape,
    Strait,
    Sea,
    Region,
    Road,
    Marker,
    Title,
}

impl EntityKind {
    pub const ALL: [EntityKind; 14] = [
        EntityKind::Settlement,
        EntityKind::River,
        EntityKind::Lake,
        EntityKind::Range,
        EntityKind::Peak,
        EntityKind::Forest,
        EntityKind::Bay,
        EntityKind::Cape,
        EntityKind::Strait,
        EntityKind::Sea,
        EntityKind::Region,
        EntityKind::Road,
        EntityKind::Marker,
        EntityKind::Title,
    ];
    pub fn label(self) -> &'static str {
        match self {
            EntityKind::Settlement => "Settlement",
            EntityKind::River => "River",
            EntityKind::Lake => "Lake",
            EntityKind::Range => "Range",
            EntityKind::Peak => "Peak",
            EntityKind::Forest => "Forest",
            EntityKind::Bay => "Bay",
            EntityKind::Cape => "Cape",
            EntityKind::Strait => "Strait",
            EntityKind::Sea => "Sea",
            EntityKind::Region => "Region",
            EntityKind::Road => "Road",
            EntityKind::Marker => "Marker",
            EntityKind::Title => "Title",
        }
    }
    /// Template key in culture packs.
    pub fn name_key(self) -> &'static str {
        match self {
            EntityKind::Settlement => "settlement",
            EntityKind::River => "river",
            EntityKind::Lake => "lake",
            EntityKind::Range => "range",
            EntityKind::Peak => "peak",
            EntityKind::Forest => "forest",
            EntityKind::Bay | EntityKind::Strait => "bay",
            EntityKind::Cape => "peak",
            EntityKind::Sea => "sea",
            EntityKind::Region => "region",
            EntityKind::Road => "settlement",
            EntityKind::Marker => "settlement",
            EntityKind::Title => "title",
        }
    }
}

/// What an entity refers to. Geometry is snapshotted so a label survives
/// recomputation of the derived features it came from.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub enum EntityRef {
    Point(P2),
    /// A path the label follows (rivers, ranges, roads).
    Path(Vec<P2>),
    Polygon(Polygon),
    /// A round-ish area labelled across its centre (forests, seas, regions).
    Area { center: P2, radius: f32 },
    /// A placed symbol (by placement id) with its anchor.
    Placement { id: u64, pos: P2 },
}

impl EntityRef {
    pub fn anchor(&self) -> P2 {
        match self {
            EntityRef::Point(p) => *p,
            EntityRef::Path(pts) => pts.get(pts.len() / 2).copied().unwrap_or([0.0, 0.0]),
            EntityRef::Polygon(pg) => {
                let n = pg.points.len().max(1) as f32;
                let mut c = [0.0, 0.0];
                for p in &pg.points {
                    c[0] += p[0] / n;
                    c[1] += p[1] / n;
                }
                c
            }
            EntityRef::Area { center, .. } => *center,
            EntityRef::Placement { pos, .. } => *pos,
        }
    }
}

/// Persisted per-label manual adjustments.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, Default)]
pub struct LabelOverride {
    /// Offset from the automatic position, in field texels.
    pub offset: [f32; 2],
    /// Extra rotation, radians (point labels) or path parameter shift (0..1).
    pub angle: f32,
    pub shift: f32,
    /// -1..1 bend for arc labels.
    pub curvature: f32,
    pub size_mult: f32,
    pub letter_spacing: f32,
    pub hidden: bool,
    /// The user dragged it; keep it where it is regardless of declutter.
    pub pinned: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Entity {
    pub id: u64,
    pub kind: EntityKind,
    pub name: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub notes: String,
    /// 0..1; drives label size and declutter priority.
    #[serde(default = "default_importance")]
    pub importance: f32,
    pub geometry: EntityRef,
    #[serde(default)]
    pub label: LabelOverride,
    /// Free-form style overrides (`"color": "#ff0000"` …), applied by the renderer when known.
    #[serde(default)]
    pub style: std::collections::BTreeMap<String, String>,
    /// Culture id the name came from, for consistent propagation.
    #[serde(default)]
    pub culture: String,
    /// Set for entities the auto-namer created and the user has not edited.
    #[serde(default)]
    pub auto: bool,
}

fn default_importance() -> f32 {
    0.5
}

impl Entity {
    pub fn new(id: u64, kind: EntityKind, name: impl Into<String>, geometry: EntityRef) -> Self {
        Self {
            id,
            kind,
            name: name.into(),
            tags: Vec::new(),
            notes: String::new(),
            importance: 0.5,
            geometry,
            label: LabelOverride { size_mult: 1.0, ..Default::default() },
            style: Default::default(),
            culture: String::new(),
            auto: false,
        }
    }
}

/// Gazetteer export.
pub fn gazetteer_csv(entities: &[Entity]) -> String {
    let mut s = String::from("id,kind,name,x,y,importance,tags,notes\n");
    for e in entities {
        let a = e.geometry.anchor();
        let esc = |t: &str| format!("\"{}\"", t.replace('"', "\"\""));
        s.push_str(&format!("{},{},{},{:.1},{:.1},{:.2},{},{}\n", e.id, e.kind.label(), esc(&e.name), a[0], a[1], e.importance, esc(&e.tags.join(";")), esc(&e.notes)));
    }
    s
}

pub fn gazetteer_json(entities: &[Entity]) -> String {
    #[derive(Serialize)]
    struct Row<'a> {
        id: u64,
        kind: &'a str,
        name: &'a str,
        x: f32,
        y: f32,
        importance: f32,
        tags: &'a [String],
        notes: &'a str,
        culture: &'a str,
    }
    let rows: Vec<Row> = entities
        .iter()
        .map(|e| {
            let a = e.geometry.anchor();
            Row { id: e.id, kind: e.kind.label(), name: &e.name, x: a[0], y: a[1], importance: e.importance, tags: &e.tags, notes: &e.notes, culture: &e.culture }
        })
        .collect();
    serde_json::to_string_pretty(&rows).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_escapes_quotes() {
        let mut e = Entity::new(1, EntityKind::Lake, "Lake \"Deep\"", EntityRef::Point([10.0, 20.0]));
        e.notes = "a, b".into();
        let csv = gazetteer_csv(&[e]);
        assert!(csv.contains("\"Lake \"\"Deep\"\"\""));
        assert!(csv.contains("\"a, b\""));
        assert!(csv.lines().count() == 2);
    }
}
