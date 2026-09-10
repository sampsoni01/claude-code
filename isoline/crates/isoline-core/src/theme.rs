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
}

impl ForestStyle {
    pub const ALL: [ForestStyle; 3] = [ForestStyle::Clumps, ForestStyle::Stipple, ForestStyle::None];
    pub fn label(self) -> &'static str {
        match self {
            ForestStyle::None => "None",
            ForestStyle::Clumps => "Tree clumps",
            ForestStyle::Stipple => "Stipple",
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
            forest: ForestStyle::Clumps,
            forest_scale: 12.0,
            forest_threshold: 0.3,
            show_ornaments: true,
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
            forest: ForestStyle::Clumps,
            forest_scale: 12.0,
            forest_threshold: 0.3,
            show_ornaments: true,
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
