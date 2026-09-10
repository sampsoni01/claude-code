//! Renders every SVG in a symbol pack onto a parchment-coloured sheet so the
//! drawings can be checked without launching the editor.
//!   cargo run --release -p isoline-core --example contact_sheet -- assets/packs/default out.png [filter]
use isoline_core::assets::{rasterize_svg, Bitmap};

fn main() {
    let mut args = std::env::args().skip(1);
    let dir = args.next().expect("pack dir");
    let out = args.next().expect("output png");
    let filter = args.next().unwrap_or_default();
    let mut files: Vec<_> = std::fs::read_dir(&dir)
        .unwrap()
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().map(|e| e == "svg").unwrap_or(false) && p.file_name().unwrap().to_string_lossy().contains(&filter))
        .collect();
    files.sort();
    let cell = 220u32;
    let cols = 6u32;
    let rows = (files.len() as u32).div_ceil(cols).max(1);
    let mut sheet = Bitmap::new(cols * cell, rows * cell);
    for y in 0..sheet.height {
        for x in 0..sheet.width {
            let g = ((x * 7 + y * 13) % 11) as u8;
            sheet.set(x, y, [226 - g, 212 - g, 182 - g, 255]);
        }
    }
    for (i, f) in files.iter().enumerate() {
        let data = std::fs::read(f).unwrap();
        let bm = rasterize_svg(&data, 200).unwrap();
        let ox = (i as u32 % cols) * cell + (cell - bm.width.min(cell)) / 2;
        let oy = (i as u32 / cols) * cell + (cell - bm.height.min(cell)) / 2;
        for y in 0..bm.height.min(cell) {
            for x in 0..bm.width.min(cell) {
                let s = &bm.rgba[((y * bm.width + x) * 4) as usize..][..4];
                let a = s[3] as u32;
                if a == 0 {
                    continue;
                }
                let di = (((oy + y) * sheet.width + ox + x) * 4) as usize;
                for (c, sc) in s.iter().enumerate().take(3) {
                    let d = sheet.rgba[di + c] as u32;
                    sheet.rgba[di + c] = ((*sc as u32 * a + d * (255 - a)) / 255) as u8;
                }
            }
        }
    }
    image::save_buffer(&out, &sheet.rgba, sheet.width, sheet.height, image::ColorType::Rgba8).unwrap();
    println!("{} symbols -> {}", files.len(), out);
}
