//! Write the bundled example theme files (variations on the presets).
//!   cargo run -p isoline-core --example dump_themes -- assets/themes
use isoline_core::theme::{Theme, ThemeStyle};

fn main() {
    let dir = std::env::args().nth(1).expect("output dir");
    std::fs::create_dir_all(&dir).unwrap();
    let mut sepia = Theme::preset(ThemeStyle::Illuminated);
    sepia.name = "Sepia atlas".into();
    sepia.paper = [0.86, 0.76, 0.58];
    sepia.paper_dark = [0.62, 0.50, 0.34];
    sepia.ink = [0.24, 0.16, 0.09];
    sepia.sea_fill = [0.70, 0.66, 0.52];
    sepia.land_tint = 0.08;
    sepia.paper_grain = 0.7;
    sepia.vignette = 0.6;
    sepia.labels.recolor([0.22, 0.14, 0.08]);
    let mut night = Theme::preset(ThemeStyle::ParchmentInk);
    night.name = "Night ink".into();
    night.paper = [0.16, 0.17, 0.20];
    night.paper_dark = [0.08, 0.09, 0.11];
    night.ink = [0.85, 0.82, 0.72];
    night.sea_fill = [0.12, 0.15, 0.20];
    night.sea_ink = [0.55, 0.62, 0.72];
    night.river_ink = [0.55, 0.62, 0.72];
    night.forest_fill = [0.20, 0.26, 0.20];
    night.paper_grain = 0.35;
    night.vignette = 0.2;
    night.labels.recolor([0.9, 0.87, 0.78]);
    let mut blueprint = Theme::preset(ThemeStyle::Modern);
    blueprint.name = "Blueprint".into();
    blueprint.paper = [0.90, 0.93, 0.97];
    blueprint.ink = [0.15, 0.25, 0.45];
    blueprint.sea_fill = [0.62, 0.74, 0.90];
    blueprint.sea_ink = [0.25, 0.38, 0.62];
    blueprint.river_ink = [0.25, 0.38, 0.62];
    blueprint.hillshade_strength = 0.5;
    blueprint.labels.recolor([0.12, 0.2, 0.4]);
    for (file, t) in [("sepia-atlas.json", sepia), ("night-ink.json", night), ("blueprint.json", blueprint)] {
        std::fs::write(format!("{dir}/{file}"), serde_json::to_vec_pretty(&t).unwrap()).unwrap();
        println!("wrote {dir}/{file}");
    }
}
