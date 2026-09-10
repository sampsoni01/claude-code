//! Label layout, declutter and drawing. Text is set glyph by glyph along a
//! baseline from `isoline_core::labels`, measured with egui's fonts, then
//! decluttered greedily by priority in screen space every frame.

use crate::camera::Camera;
use crate::ui::{serif, serif_italic};
use glam::Vec2;
use isoline_core::entity::{Entity, EntityKind};
use isoline_core::labels::{baseline_for, Baseline};
use isoline_core::theme::{LabelClass, Theme};
use std::collections::HashMap;
use std::sync::Arc;

pub struct Glyph {
    pub pos: egui::Pos2,
    pub angle: f32,
    pub galley: Arc<egui::Galley>,
    pub aabb: egui::Rect,
}

pub struct PlacedLabel {
    pub entity: u64,
    pub glyphs: Vec<Glyph>,
    pub bbox: egui::Rect,
    pub color: egui::Color32,
    pub halo: f32,
    pub shadow: bool,
    pub visible: bool,
}

#[derive(Default)]
pub struct LabelEngine {
    cache: HashMap<(u32, bool, bool, char), Arc<egui::Galley>>,
    pub placed: Vec<PlacedLabel>,
    pub hidden_by_declutter: usize,
}

fn font_for(class: &LabelClass, size: f32) -> egui::FontId {
    if class.italic {
        serif_italic(size)
    } else {
        serif(size)
    }
}

fn rotated_aabb(center: egui::Pos2, w: f32, h: f32, angle: f32) -> egui::Rect {
    let (s, c) = angle.sin_cos();
    let ex = (w * 0.5 * c).abs() + (h * 0.5 * s).abs();
    let ey = (w * 0.5 * s).abs() + (h * 0.5 * c).abs();
    egui::Rect::from_center_size(center, egui::vec2(ex * 2.0, ey * 2.0))
}

impl LabelEngine {
    fn glyph(&mut self, ctx: &egui::Context, class: &LabelClass, size: f32, ch: char) -> Arc<egui::Galley> {
        let key = ((size * 4.0) as u32, class.italic, class.bold, ch);
        if let Some(g) = self.cache.get(&key) {
            return g.clone();
        }
        let font = font_for(class, size);
        let g = ctx.fonts_mut(|f| f.layout_no_wrap(ch.to_string(), font, egui::Color32::WHITE));
        if self.cache.len() > 4000 {
            self.cache.clear();
        }
        self.cache.insert(key, g.clone());
        g
    }

    /// Lay out and declutter every entity's label for the current view.
    #[allow(clippy::too_many_arguments)]
    pub fn layout(&mut self, ctx: &egui::Context, entities: &[Entity], theme: &Theme, camera: &Camera, screen_size: Vec2, field_size: Vec2, ppp: f32, symbol_half_height: impl Fn(&Entity) -> f32, selected: Option<u64>) {
        self.placed.clear();
        self.hidden_by_declutter = 0;
        if !theme.show_labels {
            return;
        }
        let zoom = camera.zoom;
        // Priority: pinned, then importance, then kind weight.
        let mut order: Vec<&Entity> = entities.iter().filter(|e| !e.label.hidden && !e.name.trim().is_empty()).collect();
        let kind_weight = |k: EntityKind| match k {
            EntityKind::Title => 3.0,
            EntityKind::Sea | EntityKind::Region => 2.0,
            EntityKind::Settlement => 1.5,
            EntityKind::Range => 1.2,
            _ => 1.0,
        };
        order.sort_by(|a, b| {
            let ka = (a.label.pinned as i32, (a.importance * kind_weight(a.kind) * 100.0) as i32);
            let kb = (b.label.pinned as i32, (b.importance * kind_weight(b.kind) * 100.0) as i32);
            kb.cmp(&ka)
        });
        let mut occupied: Vec<egui::Rect> = Vec::new();
        for e in order {
            let class = theme.labels.for_kind(e.kind);
            if zoom < class.min_zoom || zoom > class.max_zoom {
                continue;
            }
            let size_px = (class.size * (0.6 + 0.8 * e.importance) * e.label.size_mult.max(0.2)).clamp(6.0, 96.0);
            let text: String = if class.uppercase { e.name.to_uppercase() } else { e.name.clone() };
            let spacing_px = class.letter_spacing + e.label.letter_spacing;
            // Measure.
            let mut widths = Vec::new();
            let mut total = 0.0;
            for ch in text.chars() {
                let g = self.glyph(ctx, class, size_px, ch);
                let w = g.size().x;
                widths.push((ch, w));
                total += w + spacing_px;
            }
            if total <= 0.0 {
                continue;
            }
            let len_texels = total / zoom * ppp;
            let mut base: Baseline = baseline_for(e, len_texels, size_px / zoom * ppp, symbol_half_height(e));
            if matches!(e.geometry, isoline_core::entity::EntityRef::Area { .. } | isoline_core::entity::EntityRef::Polygon(_)) {
                base = isoline_core::labels::clamp_to_field(base, field_size.x, field_size.y);
            }
            if !class.curved && !matches!(e.geometry, isoline_core::entity::EntityRef::Point(_) | isoline_core::entity::EntityRef::Placement { .. }) {
                // Straight label through the anchor.
                let a = e.geometry.anchor();
                let half = len_texels * 0.5;
                base = Baseline::new(vec![[a[0] - half, a[1]], [a[0] + half, a[1]]]);
            }
            if base.length() < len_texels {
                base = base.extended_to(len_texels * 1.02);
            }
            let blen = base.length().max(1e-3);
            let start = ((blen - len_texels) * 0.5 + e.label.shift * blen).max(0.0);
            let mut glyphs = Vec::with_capacity(widths.len());
            let mut s = start;
            let mut bbox = egui::Rect::NOTHING;
            let height_px = size_px;
            for (ch, w) in widths {
                let w_tex = w / zoom * ppp;
                let (p, t) = base.at(s + w_tex * 0.5);
                let angle = t[1].atan2(t[0]);
                // Baseline sits under the glyph: shift up by half the height.
                let up = [t[1], -t[0]];
                let hh = height_px * 0.5 / zoom * ppp;
                let centre = [p[0] + up[0] * hh, p[1] + up[1] * hh];
                let sc = camera.field_to_screen(Vec2::from(centre), screen_size) / ppp;
                let centre_pt = egui::pos2(sc.x, sc.y);
                let aabb = rotated_aabb(centre_pt, w, height_px, angle);
                bbox = bbox.union(aabb);
                // egui rotates around the galley's top-left; compute that corner.
                let (sa, ca) = angle.sin_cos();
                let half = egui::vec2(w * 0.5, height_px * 0.5);
                let corner = egui::pos2(centre_pt.x - half.x * ca + half.y * sa, centre_pt.y - half.x * sa - half.y * ca);
                let galley = self.glyph(ctx, class, size_px, ch);
                glyphs.push(Glyph { pos: corner, angle, galley, aabb });
                s += w_tex + spacing_px / zoom * ppp;
            }
            let color = egui::Color32::from_rgb((class.color[0] * 255.0) as u8, (class.color[1] * 255.0) as u8, (class.color[2] * 255.0) as u8);
            let mut visible = true;
            let padded = bbox.expand(2.0);
            if !e.label.pinned && selected != Some(e.id) && occupied.iter().any(|o| o.intersects(padded)) {
                // Glyph-level check before giving up (curved labels have sparse boxes).
                let hit = glyphs.iter().any(|g| occupied.iter().any(|o| o.intersects(g.aabb)));
                if hit {
                    visible = false;
                    self.hidden_by_declutter += 1;
                }
            }
            if visible {
                for g in &glyphs {
                    occupied.push(g.aabb);
                }
            }
            self.placed.push(PlacedLabel { entity: e.id, glyphs, bbox, color, halo: class.halo, shadow: class.shadow, visible });
        }
    }

    pub fn draw(&self, painter: &egui::Painter, paper: egui::Color32, selected: Option<u64>) {
        for l in &self.placed {
            if !l.visible {
                continue;
            }
            if l.halo > 0.0 {
                let r = l.halo;
                for (dx, dy) in [(-r, 0.0), (r, 0.0), (0.0, -r), (0.0, r), (-r * 0.7, -r * 0.7), (r * 0.7, -r * 0.7), (-r * 0.7, r * 0.7), (r * 0.7, r * 0.7)] {
                    for g in &l.glyphs {
                        let mut shape = egui::epaint::TextShape::new(g.pos + egui::vec2(dx, dy), g.galley.clone(), paper);
                        shape.angle = g.angle;
                        shape.override_text_color = Some(paper);
                        painter.add(egui::Shape::Text(shape));
                    }
                }
            }
            if l.shadow {
                for g in &l.glyphs {
                    let mut shape = egui::epaint::TextShape::new(g.pos + egui::vec2(1.5, 1.5), g.galley.clone(), egui::Color32::from_black_alpha(90));
                    shape.angle = g.angle;
                    shape.override_text_color = Some(egui::Color32::from_black_alpha(90));
                    painter.add(egui::Shape::Text(shape));
                }
            }
            for g in &l.glyphs {
                let mut shape = egui::epaint::TextShape::new(g.pos, g.galley.clone(), l.color);
                shape.angle = g.angle;
                shape.override_text_color = Some(l.color);
                painter.add(egui::Shape::Text(shape));
            }
            if selected == Some(l.entity) {
                painter.rect_stroke(l.bbox.expand(3.0), egui::CornerRadius::same(3), egui::Stroke::new(1.0, egui::Color32::from_rgb(230, 190, 80)), egui::StrokeKind::Outside);
            }
        }
    }

    /// Entity whose label contains the screen point (points, not pixels).
    pub fn hit(&self, p: egui::Pos2) -> Option<u64> {
        self.placed.iter().filter(|l| l.visible && l.bbox.expand(3.0).contains(p)).map(|l| l.entity).next()
    }
}
