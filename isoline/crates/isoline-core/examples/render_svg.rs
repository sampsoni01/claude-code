//! Rasterize an SVG (such as an Isoline vector export) to PNG for checking.
//!   cargo run --release -p isoline-core --example render_svg -- in.svg out.png [max_edge]
use isoline_core::assets::rasterize_svg;

fn main() {
    let mut args = std::env::args().skip(1);
    let input = args.next().expect("input svg");
    let out = args.next().expect("output png");
    let max: u32 = args.next().and_then(|s| s.parse().ok()).unwrap_or(2048);
    let data = std::fs::read(&input).unwrap();
    let bm = rasterize_svg(&data, max).unwrap();
    image::save_buffer(&out, &bm.rgba, bm.width, bm.height, image::ColorType::Rgba8).unwrap();
    println!("{}×{} -> {}", bm.width, bm.height, out);
}
