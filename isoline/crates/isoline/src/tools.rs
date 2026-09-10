//! Tool selection and per-stroke state.

use isoline_core::brush::{BlendMode, BrushSettings, Dab, StrokeSampler};
use isoline_core::borders::BorderStyle;
use isoline_core::procedural::{CoastParams, RidgeParams};
use isoline_core::settlement::{District, SettlementParams};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tool {
    Raise,
    Lower,
    Smooth,
    Flatten,
    Ridge,
    Coast,
    Moisture,
    WaterEdit,
    Place,
    Scatter,
    Name,
    Border,
    Territory,
    Settlement,
    Pan,
}

impl Tool {
    pub const ALL: [Tool; 15] = [
        Tool::Raise,
        Tool::Lower,
        Tool::Smooth,
        Tool::Flatten,
        Tool::Ridge,
        Tool::Coast,
        Tool::Place,
        Tool::Scatter,
        Tool::Name,
        Tool::Border,
        Tool::Territory,
        Tool::Settlement,
        Tool::Moisture,
        Tool::WaterEdit,
        Tool::Pan,
    ];

    pub fn label(self) -> &'static str {
        match self {
            Tool::Raise => "Raise",
            Tool::Lower => "Lower",
            Tool::Smooth => "Smooth",
            Tool::Flatten => "Flatten",
            Tool::Ridge => "Ridge",
            Tool::Coast => "Coast",
            Tool::Moisture => "Moisture",
            Tool::WaterEdit => "Water edit",
            Tool::Place => "Place symbol",
            Tool::Scatter => "Scatter symbols",
            Tool::Name => "Name & label",
            Tool::Border => "Border",
            Tool::Territory => "Realms",
            Tool::Settlement => "Towns",
            Tool::Pan => "Pan",
        }
    }

    pub fn hotkey(self) -> &'static str {
        match self {
            Tool::Raise => "1",
            Tool::Lower => "2",
            Tool::Smooth => "3",
            Tool::Flatten => "4",
            Tool::Ridge => "5",
            Tool::Coast => "6",
            Tool::Place => "7",
            Tool::Scatter => "8",
            Tool::Name => "N",
            Tool::Border => "B",
            Tool::Territory => "T",
            Tool::Settlement => "S",
            Tool::Moisture => "9 (baked water only)",
            Tool::WaterEdit => "0 (baked water only)",
            Tool::Pan => "Space",
        }
    }

    /// Dab brushes and the field they paint.
    pub fn blend_mode(self) -> Option<BlendMode> {
        match self {
            Tool::Raise => Some(BlendMode::Add),
            Tool::Lower => Some(BlendMode::Subtract),
            Tool::Smooth => Some(BlendMode::Smooth),
            Tool::Flatten => Some(BlendMode::Set),
            Tool::Moisture => Some(BlendMode::Add),
            _ => None,
        }
    }

    pub fn is_dab_brush(self) -> bool {
        self.blend_mode().is_some()
    }

    /// Stroke-level procedural brushes.
    pub fn is_procedural(self) -> bool {
        matches!(self, Tool::Ridge | Tool::Coast)
    }

    pub fn needs_baked_water(self) -> bool {
        matches!(self, Tool::Moisture | Tool::WaterEdit)
    }

    pub fn uses_assets(self) -> bool {
        matches!(self, Tool::Place | Tool::Scatter)
    }
}

/// Scatter brush settings.
#[derive(Clone, Debug, PartialEq)]
pub struct ScatterSettings {
    pub radius: f32,
    /// Spacing between symbols in texels.
    pub spacing: f32,
    pub size_jitter: f32,
    pub rotation_jitter_deg: f32,
    pub flip: bool,
    pub avoid_water: bool,
    pub max_slope: f32,
    pub erase: bool,
}

impl Default for ScatterSettings {
    fn default() -> Self {
        Self { radius: 120.0, spacing: 22.0, size_jitter: 0.25, rotation_jitter_deg: 0.0, flip: true, avoid_water: true, max_slope: 80.0, erase: false }
    }
}

/// Moisture brush direction.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MoistureMode {
    Wetter,
    Drier,
    Smooth,
}

pub struct ToolState {
    pub tool: Tool,
    pub brush: BrushSettings,
    pub moisture_brush: BrushSettings,
    pub moisture_mode: MoistureMode,
    pub ridge: RidgeParams,
    pub coast: CoastParams,
    pub sampler: Option<StrokeSampler>,
    /// Dabs produced but not yet dispatched to the GPU.
    pub queued: Vec<Dab>,
    pub stroke_seed: u64,
    pub stroke_dabs: u32,
    /// Raw path of an in-progress procedural stroke, in field coordinates.
    pub path: Vec<[f32; 2]>,
    /// Selected asset (qualified id) for Place / Scatter; several for scatter.
    pub selected_assets: Vec<String>,
    pub place_size: f32,
    pub scatter: ScatterSettings,
    /// Border brush: 0 = straight surveyed segments, 1 = follows terrain.
    pub border_naturalness: f32,
    pub border_style: BorderStyle,
    /// Settings for the next town placed (and edits to the selected one).
    pub settlement: SettlementParams,
    /// District painting over a selected town's buildings.
    pub paint_district: bool,
    pub paint_kind: District,
    pub paint_radius: f32,
}

impl Default for ToolState {
    fn default() -> Self {
        Self {
            tool: Tool::Raise,
            brush: BrushSettings::default(),
            moisture_brush: BrushSettings { amount: 0.08, strength: 0.6, radius: 96.0, ..Default::default() },
            moisture_mode: MoistureMode::Wetter,
            ridge: RidgeParams::default(),
            coast: CoastParams::default(),
            sampler: None,
            queued: Vec::new(),
            stroke_seed: 0x1234_5678,
            stroke_dabs: 0,
            path: Vec::new(),
            selected_assets: Vec::new(),
            place_size: 0.0,
            scatter: ScatterSettings::default(),
            border_naturalness: 0.8,
            border_style: BorderStyle::Dashed,
            settlement: SettlementParams::default(),
            paint_district: false,
            paint_kind: District::Craft,
            paint_radius: 18.0,
        }
    }
}

impl ToolState {
    /// Effective settings and blend mode for the current dab brush.
    pub fn dab_settings(&self) -> (BrushSettings, BlendMode) {
        match self.tool {
            Tool::Moisture => {
                let s = self.moisture_brush.clone();
                let mode = match self.moisture_mode {
                    MoistureMode::Wetter => BlendMode::Add,
                    MoistureMode::Drier => BlendMode::Subtract,
                    MoistureMode::Smooth => BlendMode::Smooth,
                };
                (s, mode)
            }
            Tool::Smooth | Tool::Flatten => {
                let mut s = self.brush.clone();
                s.strength = self.brush.strength.clamp(0.0, 1.0);
                (s, self.tool.blend_mode().unwrap())
            }
            _ => (self.brush.clone(), self.tool.blend_mode().unwrap_or(BlendMode::Add)),
        }
    }

    pub fn radius(&self) -> f32 {
        match self.tool {
            Tool::Moisture => self.moisture_brush.radius,
            Tool::Ridge => self.ridge.width,
            Tool::Coast => self.coast.band,
            Tool::Scatter => self.scatter.radius,
            Tool::Place | Tool::Name | Tool::Border | Tool::Territory => 0.0,
            Tool::Settlement => if self.paint_district { self.paint_radius } else { 0.0 },
            _ => self.brush.radius,
        }
    }
}
