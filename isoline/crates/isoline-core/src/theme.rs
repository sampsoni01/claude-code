//! Visual themes. Every visual layer reads its colours, line weights and
//! textures from here; themes are user-authorable and saved with projects.

use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ThemeStyle {
    /// Clean coloured cartography: hypsometric/biome tints, smooth shading.
    Modern = 0,
    /// Ink on parchment: hatched relief, ink coasts, coastal rings, scribbled woods.
    ParchmentInk = 1,
    /// Parchment with washed colour: tinted lands, green woods, blue seas.
    Illuminated = 2,
}

impl ThemeStyle {
    pub const ALL: [ThemeStyle; 3] = [ThemeStyle::ParchmentInk, ThemeStyle::Illuminated, ThemeStyle::Modern];
    pub fn label(self) -> &'static str {
        match self {
            ThemeStyle::Modern => "Modern",
            ThemeStyle::ParchmentInk => "Parchment & ink",
            ThemeStyle::Illuminated => "Illuminated",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ReliefStyle {
    /// Smooth light and shadow.
    Shaded = 0,
    /// Engraving-style hatch lines that thicken in shadow.
    Hatched = 1,
    /// Both.
    ShadedHatched = 2,
}

impl ReliefStyle {
    pub const ALL: [ReliefStyle; 3] = [ReliefStyle::Hatched, ReliefStyle::ShadedHatched, ReliefStyle::Shaded];
    pub fn label(self) -> &'static str {
        match self {
            ReliefStyle::Shaded => "Shaded",
            ReliefStyle::Hatched => "Hatched",
            ReliefStyle::ShadedHatched => "Shaded + hatched",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum ForestStyle {
    None = 0,
    /// Hand-drawn tree clumps.
    Clumps = 1,
    /// Stippled dots.
    Stipple = 2,
    /// Tree symbols from the asset library (placed by the forest layer).
    Symbols = 3,
}

impl ForestStyle {
    pub const ALL: [ForestStyle; 4] = [ForestStyle::Symbols, ForestStyle::Clumps, ForestStyle::Stipple, ForestStyle::None];
    pub fn label(self) -> &'static str {
        match self {
            ForestStyle::None => "None",
            ForestStyle::Clumps => "Tree clumps",
            ForestStyle::Stipple => "Stipple",
            ForestStyle::Symbols => "Tree symbols",
        }
    }
}

/// Typography for one class of label.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LabelClass {
    /// Screen pixels at importance 0.5.
    pub size: f32,
    pub italic: bool,
    pub bold: bool,
    pub uppercase: bool,
    /// Extra spacing between letters, in screen pixels.
    pub letter_spacing: f32,
    pub color: [f32; 3],
    /// Halo width in screen pixels (0 = none).
    pub halo: f32,
    pub shadow: bool,
    /// Visible when the map zoom (screen px per texel) is within this range.
    pub min_zoom: f32,
    pub max_zoom: f32,
    pub curved: bool,
}

impl LabelClass {
    fn new(size: f32, italic: bool, bold: bool, uppercase: bool, letter_spacing: f32, curved: bool, min_zoom: f32) -> Self {
        Self { size, italic, bold, uppercase, letter_spacing, color: [0.22, 0.15, 0.09], halo: 2.0, shadow: false, min_zoom, max_zoom: 100.0, curved }
    }
}

/// Label classes by entity kind.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct LabelClasses {
    pub settlement: LabelClass,
    pub river: LabelClass,
    pub lake: LabelClass,
    pub range: LabelClass,
    pub peak: LabelClass,
    pub forest: LabelClass,
    pub sea: LabelClass,
    pub region: LabelClass,
    pub marker: LabelClass,
    pub bay: LabelClass,
    pub title: LabelClass,
}

impl Default for LabelClasses {
    fn default() -> Self {
        Self {
            settlement: LabelClass::new(14.0, false, false, false, 0.5, false, 0.0),
            river: LabelClass::new(12.0, true, false, false, 1.0, true, 0.15),
            lake: LabelClass::new(12.0, true, false, false, 0.8, true, 0.12),
            range: LabelClass::new(15.0, false, false, true, 3.5, true, 0.0),
            peak: LabelClass::new(10.0, true, false, false, 0.3, false, 0.6),
            forest: LabelClass::new(13.0, true, false, false, 1.5, true, 0.2),
            sea: LabelClass::new(22.0, true, false, true, 6.0, true, 0.0),
            region: LabelClass::new(20.0, false, true, true, 5.0, true, 0.0),
            marker: LabelClass::new(11.0, false, false, false, 0.3, false, 0.5),
            bay: LabelClass::new(12.0, true, false, false, 1.2, true, 0.25),
            title: LabelClass::new(30.0, true, true, false, 1.0, false, 0.0),
        }
    }
}

impl LabelClasses {
    pub fn for_kind(&self, kind: crate::entity::EntityKind) -> &LabelClass {
        use crate::entity::EntityKind as K;
        match kind {
            K::Settlement => &self.settlement,
            K::River => &self.river,
            K::Lake => &self.lake,
            K::Range => &self.range,
            K::Peak | K::Cape => &self.peak,
            K::Forest => &self.forest,
            K::Sea => &self.sea,
            K::Region => &self.region,
            K::Marker | K::Road => &self.marker,
            K::Bay | K::Strait => &self.bay,
            K::Title => &self.title,
        }
    }
    pub fn for_kind_mut(&mut self, kind: crate::entity::EntityKind) -> &mut LabelClass {
        use crate::entity::EntityKind as K;
        match kind {
            K::Settlement => &mut self.settlement,
            K::River => &mut self.river,
            K::Lake => &mut self.lake,
            K::Range => &mut self.range,
            K::Peak | K::Cape => &mut self.peak,
            K::Forest => &mut self.forest,
            K::Sea => &mut self.sea,
            K::Region => &mut self.region,
            K::Marker | K::Road => &mut self.marker,
            K::Bay | K::Strait => &mut self.bay,
            K::Title => &mut self.title,
        }
    }
    pub fn recolor(&mut self, ink: [f32; 3]) {
        for c in [&mut self.settlement, &mut self.river, &mut self.lake, &mut self.range, &mut self.peak, &mut self.forest, &mut self.sea, &mut self.region, &mut self.marker, &mut self.bay, &mut self.title] {
            c.color = ink;
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Theme {
    pub name: String,
    pub style: ThemeStyle,
    pub paper: [f32; 3],
    pub paper_dark: [f32; 3],
    pub ink: [f32; 3],
    pub sea_fill: [f32; 3],
    pub sea_ink: [f32; 3],
    pub river_ink: [f32; 3],
    pub forest_fill: [f32; 3],
    /// 0..1 how strongly biome/hypsometric colour tints the land.
    pub land_tint: f32,
    pub paper_grain: f32,
    pub vignette: f32,
    pub coast_line_width: f32,
    /// Number of concentric shoreline rings in the sea.
    pub coast_rings: u32,
    /// Elevation spacing (units) between rings.
    pub ring_spacing: f32,
    pub relief: ReliefStyle,
    pub hatch_strength: f32,
    /// Hatch line spacing in screen pixels.
    pub hatch_spacing: f32,
    pub hillshade_strength: f32,
    pub forest: ForestStyle,
    /// Tree clump size in texels.
    pub forest_scale: f32,
    pub forest_threshold: f32,
    pub show_ornaments: bool,
    #[serde(default)]
    pub labels: LabelClasses,
    #[serde(default = "default_true")]
    pub show_labels: bool,
}

fn default_true() -> bool {
    true
}

impl Theme {
    pub fn parchment_ink() -> Theme {
        Theme {
            name: "Parchment & ink".into(),
            style: ThemeStyle::ParchmentInk,
            paper: [0.90, 0.85, 0.72],
            paper_dark: [0.74, 0.66, 0.50],
            ink: [0.22, 0.15, 0.09],
            sea_fill: [0.86, 0.83, 0.72],
            sea_ink: [0.36, 0.34, 0.30],
            river_ink: [0.30, 0.34, 0.42],
            forest_fill: [0.78, 0.74, 0.58],
            land_tint: 0.12,
            paper_grain: 0.55,
            vignette: 0.45,
            coast_line_width: 1.8,
            coast_rings: 4,
            ring_spacing: 7.0,
            relief: ReliefStyle::Hatched,
            hatch_strength: 0.9,
            hatch_spacing: 5.0,
            hillshade_strength: 0.35,
            forest: ForestStyle::Symbols,
            forest_scale: 12.0,
            forest_threshold: 0.3,
            show_ornaments: true,
            labels: LabelClasses::default(),
            show_labels: true,
        }
    }

    pub fn illuminated() -> Theme {
        Theme {
            name: "Illuminated".into(),
            style: ThemeStyle::Illuminated,
            paper: [0.93, 0.86, 0.66],
            paper_dark: [0.78, 0.64, 0.40],
            ink: [0.30, 0.20, 0.10],
            sea_fill: [0.80, 0.86, 0.72],
            sea_ink: [0.40, 0.52, 0.40],
            river_ink: [0.30, 0.44, 0.52],
            forest_fill: [0.42, 0.58, 0.28],
            land_tint: 0.55,
            paper_grain: 0.45,
            vignette: 0.5,
            coast_line_width: 1.6,
            coast_rings: 3,
            ring_spacing: 8.0,
            relief: ReliefStyle::ShadedHatched,
            hatch_strength: 0.55,
            hatch_spacing: 5.0,
            hillshade_strength: 0.6,
            forest: ForestStyle::Symbols,
            forest_scale: 12.0,
            forest_threshold: 0.3,
            show_ornaments: true,
            labels: {
                let mut l = LabelClasses::default();
                l.recolor([0.30, 0.20, 0.10]);
                l
            },
            show_labels: true,
        }
    }

    pub fn modern() -> Theme {
        Theme {
            name: "Modern".into(),
            style: ThemeStyle::Modern,
            paper: [0.90, 0.87, 0.80],
            paper_dark: [0.80, 0.77, 0.70],
            ink: [0.16, 0.12, 0.09],
            sea_fill: [0.62, 0.80, 0.84],
            sea_ink: [0.16, 0.30, 0.50],
            river_ink: [0.36, 0.58, 0.76],
            forest_fill: [0.30, 0.50, 0.28],
            land_tint: 1.0,
            paper_grain: 0.0,
            vignette: 0.0,
            coast_line_width: 1.4,
            coast_rings: 0,
            ring_spacing: 8.0,
            relief: ReliefStyle::Shaded,
            hatch_strength: 0.0,
            hatch_spacing: 5.0,
            hillshade_strength: 0.75,
            forest: ForestStyle::None,
            forest_scale: 7.0,
            forest_threshold: 0.35,
            show_ornaments: false,
            labels: {
                let mut l = LabelClasses::default();
                l.recolor([0.12, 0.12, 0.14]);
                l
            },
            show_labels: true,
        }
    }

    pub fn preset(style: ThemeStyle) -> Theme {
        match style {
            ThemeStyle::Modern => Theme::modern(),
            ThemeStyle::ParchmentInk => Theme::parchment_ink(),
            ThemeStyle::Illuminated => Theme::illuminated(),
        }
    }
}

impl Default for Theme {
    fn default() -> Self {
        Theme::parchment_ink()
    }
}
