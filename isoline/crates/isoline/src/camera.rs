//! 2D pan/zoom camera over field coordinates.

use glam::Vec2;

#[derive(Clone, Copy, Debug)]
pub struct Camera {
    /// Field coordinate at the centre of the screen.
    pub center: Vec2,
    /// Screen pixels per field texel.
    pub zoom: f32,
}

pub const MIN_ZOOM: f32 = 0.01;
pub const MAX_ZOOM: f32 = 64.0;

impl Camera {
    pub fn new(center: Vec2, zoom: f32) -> Self {
        Self { center, zoom }
    }

    pub fn fit(field: Vec2, screen: Vec2) -> Self {
        let zoom = (screen.x / field.x).min(screen.y / field.y) * 0.92;
        Self { center: field * 0.5, zoom: zoom.clamp(MIN_ZOOM, MAX_ZOOM) }
    }

    pub fn screen_to_field(&self, screen: Vec2, screen_size: Vec2) -> Vec2 {
        (screen - screen_size * 0.5) / self.zoom + self.center
    }

    pub fn field_to_screen(&self, field: Vec2, screen_size: Vec2) -> Vec2 {
        (field - self.center) * self.zoom + screen_size * 0.5
    }

    /// Zoom by `factor`, keeping the field point under `screen` fixed.
    pub fn zoom_about(&mut self, screen: Vec2, screen_size: Vec2, factor: f32) {
        let before = self.screen_to_field(screen, screen_size);
        self.zoom = (self.zoom * factor).clamp(MIN_ZOOM, MAX_ZOOM);
        let after = self.screen_to_field(screen, screen_size);
        self.center += before - after;
    }

    pub fn pan_screen(&mut self, delta: Vec2) {
        self.center -= delta / self.zoom;
    }
}
