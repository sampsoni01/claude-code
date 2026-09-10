//! Tool selection and per-stroke state.

use isoline_core::brush::{BlendMode, BrushSettings, Dab, StrokeSampler};
use isoline_core::procedural::{CoastParams, RidgeParams};

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
    Pan,
}

impl Tool {
    pub const ALL: [Tool; 9] = [
        Tool::Raise,
        Tool::Lower,
        Tool::Smooth,
        Tool::Flatten,
        Tool::Ridge,
        Tool::Coast,
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
            Tool::Moisture => "7 (baked water only)",
            Tool::WaterEdit => "8 (baked water only)",
            Tool::Pan => "9 / Space",
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
            _ => self.brush.radius,
        }
    }
}
