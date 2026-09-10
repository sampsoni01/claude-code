//! Tool selection and per-stroke state.

use isoline_core::brush::{BlendMode, BrushSettings, Dab, StrokeSampler};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Tool {
    Raise,
    Lower,
    Smooth,
    Flatten,
    Pan,
}

impl Tool {
    pub const ALL: [Tool; 5] = [Tool::Raise, Tool::Lower, Tool::Smooth, Tool::Flatten, Tool::Pan];

    pub fn label(self) -> &'static str {
        match self {
            Tool::Raise => "Raise",
            Tool::Lower => "Lower",
            Tool::Smooth => "Smooth",
            Tool::Flatten => "Flatten",
            Tool::Pan => "Pan",
        }
    }

    pub fn hotkey(self) -> &'static str {
        match self {
            Tool::Raise => "1",
            Tool::Lower => "2",
            Tool::Smooth => "3",
            Tool::Flatten => "4",
            Tool::Pan => "5 / Space",
        }
    }

    pub fn blend_mode(self) -> Option<BlendMode> {
        match self {
            Tool::Raise => Some(BlendMode::Add),
            Tool::Lower => Some(BlendMode::Subtract),
            Tool::Smooth => Some(BlendMode::Smooth),
            Tool::Flatten => Some(BlendMode::Set),
            Tool::Pan => None,
        }
    }

    pub fn is_brush(self) -> bool {
        self.blend_mode().is_some()
    }
}

pub struct ToolState {
    pub tool: Tool,
    pub brush: BrushSettings,
    pub sampler: Option<StrokeSampler>,
    /// Dabs produced but not yet dispatched to the GPU.
    pub queued: Vec<Dab>,
    pub stroke_seed: u64,
    /// Dabs dispatched during the current stroke (for the status bar).
    pub stroke_dabs: u32,
}

impl Default for ToolState {
    fn default() -> Self {
        Self {
            tool: Tool::Raise,
            brush: BrushSettings::default(),
            sampler: None,
            queued: Vec::new(),
            stroke_seed: 0x1234_5678,
            stroke_dabs: 0,
        }
    }
}

impl ToolState {
    /// Effective settings for the current tool (smooth/flatten use strength as a mix factor).
    pub fn settings_for_tool(&self) -> BrushSettings {
        let mut s = self.brush.clone();
        match self.tool {
            Tool::Smooth | Tool::Flatten => {
                s.strength = self.brush.strength.clamp(0.0, 1.0);
            }
            _ => {}
        }
        s
    }
}
