//! Vector export: everything that is truly vector (coastlines, rivers,
//! lakes, realms, borders, towns, symbols, labels) as SVG in texel units,
//! over an optional raster of the terrain shading.

use isoline_core::borders::{Border, BorderStyle};
use isoline_core::geometry::{Polygon, P2};
use isoline_core::settlement::{District, Settlement};
use isoline_core::theme::Theme;
use std::fmt::Write;
use std::path::PathBuf;

pub struct SvgSymbol {
    pub path: PathBuf,
    pub pos: P2,
    pub size: f32,
    pub aspect: f32,
    pub pivot: [f32; 2],
    pub rotation: f32,
    pub flip: bool,
}

pub struct SvgGlyph {
    pub text: String,
    /// Top-left of the glyph box, texels.
    pub pos: P2,
    pub angle: f32,
    pub size: f32,
}

pub struct SvgLabel {
    pub glyphs: Vec<SvgGlyph>,
    pub color: [f32; 3],
    pub halo: f32,
    pub italic: bool,
    pub bold: bool,
}

pub struct SvgInput<'a> {
    pub width: u32,
    pub height: u32,
    pub theme: &'a Theme,
    pub coast: &'a [Vec<P2>],
    pub rivers: &'a [(Vec<P2>, f32)],
    pub lakes: &'a [Polygon],
    pub regions: &'a [([f32; 3], Vec<Polygon>)],
    pub borders: &'a [Border],
    pub settlements: &'a [Settlement],
    pub symbols: &'a [SvgSymbol],
    pub labels: &'a [SvgLabel],
    pub terrain_png: Option<&'a [u8]>,
    pub grid: Option<(bool, f32)>,
}

fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len() * 4 / 3 + 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

fn rgb(c: [f32; 3]) -> String {
    format!("#{:02x}{:02x}{:02x}", (c[0] * 255.0) as u8, (c[1] * 255.0) as u8, (c[2] * 255.0) as u8)
}

fn pts(v: &[P2]) -> String {
    let mut s = String::with_capacity(v.len() * 12);
    for p in v {
        let _ = write!(s, "{:.1},{:.1} ", p[0], p[1]);
    }
    s
}

fn esc(t: &str) -> String {
    t.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn district_fill(d: District, paper: [f32; 3]) -> String {
    let k = match d {
        District::Market => 0.93,
        District::Temple => 1.0,
        District::Docks => 0.86,
        District::Craft => 0.84,
        District::Noble => 0.97,
        District::Slums => 0.78,
        District::Garrison => 0.82,
        District::Farmland => 1.0,
        District::Residential => 0.88,
    };
    rgb([paper[0] * k, paper[1] * k, paper[2] * k])
}

pub fn write(input: &SvgInput<'_>) -> String {
    let th = input.theme;
    let paper = rgb(th.paper);
    let ink = rgb(th.ink);
    let (w, h) = (input.width, input.height);
    let mut s = String::new();
    let _ = writeln!(s, r##"<?xml version="1.0" encoding="UTF-8"?>"##);
    let _ = writeln!(s, r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="{w}" height="{h}" viewBox="0 0 {w} {h}">"##);
    let _ = writeln!(s, r##"<title>Isoline map</title>"##);
    // The label faces travel with the file so glyph advances match the
    // layout (viewers without @font-face support fall back to a system serif).
    let _ = writeln!(
        s,
        r##"<style>@font-face{{font-family:'Liberation Serif';font-style:normal;src:url(data:font/ttf;base64,{}) format('truetype');}}@font-face{{font-family:'Liberation Serif';font-style:italic;src:url(data:font/ttf;base64,{}) format('truetype');}}</style>"##,
        base64(include_bytes!("../assets/fonts/LiberationSerif-Regular.ttf")),
        base64(include_bytes!("../assets/fonts/LiberationSerif-Italic.ttf"))
    );
    // Paper (or the raster terrain, which carries the shading and sea).
    let _ = writeln!(s, r##"<g id="terrain"><rect width="{w}" height="{h}" fill="{paper}"/>"##);
    if let Some(png) = input.terrain_png {
        let _ = writeln!(s, r##"<image width="{w}" height="{h}" xlink:href="data:image/png;base64,{}"/>"##, base64(png));
    } else {
        for l in input.lakes {
            let _ = writeln!(s, r##"<polygon points="{}" fill="{}" stroke="{}" stroke-width="1.2"/>"##, pts(&l.points), rgb(th.sea_fill), rgb(th.sea_ink));
        }
    }
    let _ = writeln!(s, "</g>");
    // Realms.
    let _ = writeln!(s, r##"<g id="realms" fill-opacity="0.16">"##);
    for (c, rings) in input.regions {
        let mut d = String::new();
        for r in rings {
            let _ = write!(d, "M {} Z ", pts(&r.points).trim_end().replace(' ', " L "));
        }
        let _ = writeln!(s, r##"<path d="{d}" fill="{}" fill-rule="evenodd"/>"##, rgb(*c));
    }
    let _ = writeln!(s, "</g>");
    // Coast and water.
    let _ = writeln!(s, r##"<g id="coast" fill="none" stroke="{}" stroke-width="{:.2}" stroke-linejoin="round">"##, rgb(th.sea_ink), th.coast_line_width);
    for l in input.coast {
        let _ = writeln!(s, r##"<polyline points="{}"/>"##, pts(l));
    }
    let _ = writeln!(s, "</g>");
    let _ = writeln!(s, r##"<g id="rivers" fill="none" stroke="{}" stroke-linecap="round" stroke-linejoin="round">"##, rgb(th.river_ink));
    for (pts_, width) in input.rivers {
        let _ = writeln!(s, r##"<polyline points="{}" stroke-width="{:.2}"/>"##, pts(pts_), width.max(0.6));
    }
    let _ = writeln!(s, "</g>");
    if input.terrain_png.is_some() {
        let _ = writeln!(s, r##"<g id="lakes" fill="none" stroke="{}" stroke-width="1.0">"##, rgb(th.sea_ink));
        for l in input.lakes {
            let _ = writeln!(s, r##"<polygon points="{}"/>"##, pts(&l.points));
        }
        let _ = writeln!(s, "</g>");
    }
    // Borders.
    let _ = writeln!(s, r##"<g id="borders" fill="none" stroke="#70261f" stroke-width="1.4" stroke-linejoin="round">"##);
    for b in input.borders {
        if b.points.len() < 2 || (b.kind == isoline_core::borders::BorderKind::Grown && (b.left == 0 || b.right == 0)) {
            continue;
        }
        let dash = match b.style {
            BorderStyle::Dashed => r##" stroke-dasharray="7 4""##,
            BorderStyle::DashDot => r##" stroke-dasharray="8 3 1.5 3""##,
            BorderStyle::Dotted => r##" stroke-dasharray="1.5 3" stroke-linecap="round""##,
            BorderStyle::Solid => "",
        };
        let _ = writeln!(s, r##"<polyline points="{}"{dash}/>"##, pts(&b.points));
    }
    let _ = writeln!(s, "</g>");
    // Towns.
    let _ = writeln!(s, r##"<g id="towns" stroke="{ink}" stroke-linejoin="round">"##);
    for st in input.settlements {
        let l = &st.layout;
        let _ = writeln!(s, r##"<g id="town-{}">"##, st.id);
        for f in &l.fields {
            let _ = writeln!(s, r##"<polygon points="{}" fill="none" stroke-width="0.3" stroke-opacity="0.5"/>"##, pts(f));
        }
        if let Some(p) = &l.plaza {
            let _ = writeln!(s, r##"<polygon points="{}" fill="{paper}" stroke-width="0.4"/>"##, pts(&p.points));
        }
        for r in &l.roads {
            if r.primary {
                let _ = writeln!(s, r##"<polyline points="{}" fill="none" stroke-width="1.6"/><polyline points="{}" fill="none" stroke="{paper}" stroke-width="0.9"/>"##, pts(&r.points), pts(&r.points));
            } else {
                let _ = writeln!(s, r##"<polyline points="{}" fill="none" stroke-width="0.5"/>"##, pts(&r.points));
            }
        }
        for b in &l.buildings {
            let _ = writeln!(s, r##"<polygon points="{}" fill="{}" stroke-width="0.4"/>"##, pts(&b.quad), district_fill(b.district, th.paper));
        }
        for (a, b) in l.docks.iter().map(|d| (d[0], d[1])) {
            let _ = writeln!(s, r##"<line x1="{:.1}" y1="{:.1}" x2="{:.1}" y2="{:.1}" stroke-width="1.2"/>"##, a[0], a[1], b[0], b[1]);
        }
        for wall in &l.walls {
            let _ = writeln!(s, r##"<polygon points="{}" fill="none" stroke-width="1.6"/>"##, pts(&wall.points));
            for t in &wall.towers {
                let _ = writeln!(s, r##"<rect x="{:.1}" y="{:.1}" width="2" height="2" fill="{ink}"/>"##, t[0] - 1.0, t[1] - 1.0);
            }
        }
        if let Some((k, r)) = l.keep {
            let _ = writeln!(s, r##"<rect x="{:.1}" y="{:.1}" width="{:.1}" height="{:.1}" fill="{}" stroke-width="0.8"/>"##, k[0] - r, k[1] - r * 0.7, r * 2.0, r * 1.4, district_fill(District::Garrison, th.paper));
        }
        let _ = writeln!(s, "</g>");
    }
    let _ = writeln!(s, "</g>");
    // Symbols: each distinct file once as a <symbol>, then <use>.
    let _ = writeln!(s, r##"<defs>"##);
    let mut seen: Vec<PathBuf> = Vec::new();
    for sym in input.symbols {
        if seen.contains(&sym.path) {
            continue;
        }
        seen.push(sym.path.clone());
        let Ok(bytes) = std::fs::read(&sym.path) else { continue };
        let mime = match sym.path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).as_deref() {
            Some("svg") => "image/svg+xml",
            Some("jpg") | Some("jpeg") => "image/jpeg",
            Some("webp") => "image/webp",
            _ => "image/png",
        };
        let _ = writeln!(s, r##"<symbol id="sym{}" viewBox="0 0 1 1" preserveAspectRatio="none"><image width="1" height="1" preserveAspectRatio="none" xlink:href="data:{mime};base64,{}"/></symbol>"##, seen.len() - 1, base64(&bytes));
    }
    let _ = writeln!(s, "</defs>");
    let _ = writeln!(s, r##"<g id="symbols">"##);
    for sym in input.symbols {
        let Some(idx) = seen.iter().position(|p| *p == sym.path) else { continue };
        let sw = sym.size;
        let sh = sym.size / sym.aspect.max(0.05);
        let x = -sym.pivot[0] * sw;
        let y = -sym.pivot[1] * sh;
        let flip = if sym.flip { " scale(-1 1)" } else { "" };
        let _ = writeln!(
            s,
            r##"<use xlink:href="#sym{idx}" x="{x:.2}" y="{y:.2}" width="{sw:.2}" height="{sh:.2}" transform="translate({:.2} {:.2}) rotate({:.2}){flip}"/>"##,
            sym.pos[0],
            sym.pos[1],
            sym.rotation.to_degrees()
        );
    }
    let _ = writeln!(s, "</g>");
    // Grid (display layer only).
    if let Some((hex, spacing)) = input.grid {
        let _ = writeln!(s, r##"<g id="grid" fill="none" stroke="{ink}" stroke-opacity="0.25" stroke-width="0.6">"##);
        if hex {
            let r = spacing / 2.0;
            let dx = r * 3f32.sqrt();
            let mut row = 0;
            let mut y = 0.0;
            while y < h as f32 + r {
                let mut x = if row % 2 == 0 { 0.0 } else { dx * 0.5 };
                while x < w as f32 + dx {
                    let mut ps = String::new();
                    for k in 0..6 {
                        let a = (k as f32 + 0.5) * std::f32::consts::FRAC_PI_3;
                        let _ = write!(ps, "{:.1},{:.1} ", x + a.cos() * r, y + a.sin() * r);
                    }
                    let _ = writeln!(s, r##"<polygon points="{ps}"/>"##);
                    x += dx;
                }
                y += r * 1.5;
                row += 1;
            }
        } else {
            let mut x = 0.0;
            while x <= w as f32 {
                let _ = writeln!(s, r##"<line x1="{x:.1}" y1="0" x2="{x:.1}" y2="{h}"/>"##);
                x += spacing;
            }
            let mut y = 0.0;
            while y <= h as f32 {
                let _ = writeln!(s, r##"<line x1="0" y1="{y:.1}" x2="{w}" y2="{y:.1}"/>"##);
                y += spacing;
            }
        }
        let _ = writeln!(s, "</g>");
    }
    // Labels: one text element per glyph, halo by paint-order.
    // Halos first for every label, then the fills, so a neighbour's halo
    // never covers a glyph (as the on-screen renderer does).
    let _ = writeln!(s, r##"<g id="labels" font-family="Liberation Serif, Georgia, serif" dominant-baseline="text-before-edge" stroke-linejoin="round">"##);
    for pass in 0..2 {
        for l in input.labels {
            if pass == 0 && l.halo <= 0.0 {
                continue;
            }
            let style = format!("{}{}", if l.italic { r##" font-style="italic""## } else { "" }, if l.bold { r##" font-weight="bold""## } else { "" });
            let paint = if pass == 0 { format!(r##" fill="{paper}" stroke="{paper}" stroke-width="{:.2}""##, l.halo * 2.0) } else { format!(r##" fill="{}""##, rgb(l.color)) };
            let _ = writeln!(s, r##"<g{style}{paint}>"##);
            for g in &l.glyphs {
                let _ = writeln!(s, r##"<text transform="translate({:.2} {:.2}) rotate({:.2})" font-size="{:.2}">{}</text>"##, g.pos[0], g.pos[1], g.angle.to_degrees(), g.size, esc(&g.text));
            }
            let _ = writeln!(s, "</g>");
        }
    }
    let _ = writeln!(s, "</g>");
    let _ = writeln!(s, "</svg>");
    s
}
