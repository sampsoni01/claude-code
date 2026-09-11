//! Asset packs: folders of PNG / JPG / SVG symbols with an optional
//! `pack.json`. Files not listed in the manifest are registered with
//! defaults, so dropping a PNG into a pack folder is enough.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

pub const PACK_MANIFEST: &str = "pack.json";
pub const IMAGE_EXTENSIONS: [&str; 5] = ["png", "jpg", "jpeg", "webp", "svg"];
/// Longest edge SVG symbols are rasterised to.
pub const SVG_RASTER_PX: u32 = 256;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct TerrainFilter {
    /// Allowed biome ids; None = any.
    #[serde(default)]
    pub biomes: Option<Vec<u8>>,
    /// Elevation above sea level [min, max]; None = any.
    #[serde(default)]
    pub elevation: Option<[f32; 2]>,
    /// Maximum slope in elevation units per texel.
    #[serde(default)]
    pub max_slope: Option<f32>,
    /// Distance to water (texels) [min, max].
    #[serde(default)]
    pub water_distance: Option<[f32; 2]>,
    /// Require land (true), water (false) or either (None).
    #[serde(default)]
    pub on_land: Option<bool>,
}

impl Default for TerrainFilter {
    fn default() -> Self {
        Self { biomes: None, elevation: None, max_slope: None, water_distance: None, on_land: Some(true) }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AssetBehavior {
    /// Random rotation ± degrees.
    #[serde(default)]
    pub rotation_range: f32,
    /// Random scale multiplier range.
    #[serde(default = "default_scale_range")]
    pub scale_range: [f32; 2],
    #[serde(default)]
    pub flip: bool,
    #[serde(default = "default_tint")]
    pub tint: [f32; 3],
    #[serde(default)]
    pub hue_jitter: f32,
    #[serde(default)]
    pub outline: f32,
    #[serde(default = "default_shadow")]
    pub shadow: f32,
    #[serde(default = "default_true")]
    pub snap_ground: bool,
    #[serde(default)]
    pub filter: TerrainFilter,
}

fn default_scale_range() -> [f32; 2] {
    [0.85, 1.15]
}
fn default_tint() -> [f32; 3] {
    [1.0, 1.0, 1.0]
}
fn default_shadow() -> f32 {
    0.25
}
fn default_true() -> bool {
    true
}

impl Default for AssetBehavior {
    fn default() -> Self {
        Self {
            rotation_range: 0.0,
            scale_range: default_scale_range(),
            flip: true,
            tint: default_tint(),
            hue_jitter: 0.0,
            outline: 0.0,
            shadow: default_shadow(),
            snap_ground: true,
            filter: TerrainFilter::default(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct AssetDef {
    pub id: String,
    pub name: String,
    pub file: String,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Anchor in 0..1 image space; (0.5, 1.0) = bottom centre.
    #[serde(default = "default_pivot")]
    pub pivot: [f32; 2],
    /// Default width in field texels.
    #[serde(default = "default_world_size")]
    pub world_size: f32,
    #[serde(default)]
    pub behavior: AssetBehavior,
}

fn default_pivot() -> [f32; 2] {
    [0.5, 0.95]
}
fn default_world_size() -> f32 {
    48.0
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct PackManifest {
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub author: String,
    #[serde(default)]
    pub license: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub assets: Vec<AssetDef>,
}

/// A loaded pack: manifest plus every image file found in the folder.
#[derive(Clone, Debug)]
pub struct Pack {
    pub root: PathBuf,
    pub manifest: PackManifest,
    /// Assets keyed by qualified id `pack/asset`.
    pub assets: Vec<AssetDef>,
    pub pack_id: String,
}

impl Pack {
    pub fn asset_path(&self, a: &AssetDef) -> PathBuf {
        self.root.join(&a.file)
    }
}

/// Qualified id for an asset in a pack.
pub fn qualified_id(pack_id: &str, asset_id: &str) -> String {
    format!("{pack_id}/{asset_id}")
}

/// Load a pack folder. Listed assets keep their manifest settings; other
/// image files are added with defaults and tags from their sub-folder.
pub fn load_pack(dir: &Path) -> Result<Pack> {
    let manifest_path = dir.join(PACK_MANIFEST);
    let mut manifest: PackManifest = if manifest_path.exists() {
        let text = std::fs::read_to_string(&manifest_path).with_context(|| format!("read {}", manifest_path.display()))?;
        serde_json::from_str(&text).with_context(|| format!("parse {}", manifest_path.display()))?
    } else {
        PackManifest::default()
    };
    // The folder name is the pack id: it is what users see and what asset
    // references in projects are keyed by.
    let pack_id = slug(&dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "pack".into()));
    if manifest.name.is_empty() {
        manifest.name = pack_id.clone();
    }
    let mut by_file: HashMap<String, AssetDef> = manifest.assets.iter().map(|a| (a.file.replace('\\', "/"), a.clone())).collect();
    let mut assets = Vec::new();
    for entry in walkdir::WalkDir::new(dir).min_depth(1).max_depth(4).sort_by_file_name().into_iter().flatten() {
        let p = entry.path();
        if !p.is_file() {
            continue;
        }
        let ext = p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
        if !IMAGE_EXTENSIONS.contains(&ext.as_str()) {
            continue;
        }
        let rel = p.strip_prefix(dir).unwrap_or(p).to_string_lossy().replace('\\', "/");
        if let Some(a) = by_file.remove(&rel) {
            assets.push(a);
            continue;
        }
        let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "asset".into());
        let mut tags: Vec<String> = rel.split('/').take(rel.matches('/').count()).map(|s| s.to_ascii_lowercase()).collect();
        tags.push(stem.replace(['_', '-'], " ").to_ascii_lowercase());
        let category = tags.first().cloned().unwrap_or_else(|| "imported".into());
        assets.push(AssetDef {
            id: slug(&stem),
            name: stem.replace(['_', '-'], " "),
            file: rel,
            category,
            tags,
            pivot: default_pivot(),
            world_size: default_world_size(),
            behavior: AssetBehavior::default(),
        });
    }
    Ok(Pack { root: dir.to_path_buf(), manifest, assets, pack_id })
}

pub fn slug(s: &str) -> String {
    s.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '_' }).collect::<String>().trim_matches('_').to_string()
}

// ---- bitmaps ----------------------------------------------------------------

#[derive(Clone, Debug, PartialEq)]
pub struct Bitmap {
    pub width: u32,
    pub height: u32,
    /// RGBA8, straight alpha, row-major.
    pub rgba: Vec<u8>,
}

impl Bitmap {
    pub fn new(width: u32, height: u32) -> Self {
        Self { width, height, rgba: vec![0; (width * height * 4) as usize] }
    }
    #[inline]
    pub fn px(&self, x: u32, y: u32) -> [u8; 4] {
        let i = ((y * self.width + x) * 4) as usize;
        [self.rgba[i], self.rgba[i + 1], self.rgba[i + 2], self.rgba[i + 3]]
    }
    #[inline]
    pub fn set(&mut self, x: u32, y: u32, p: [u8; 4]) {
        let i = ((y * self.width + x) * 4) as usize;
        self.rgba[i..i + 4].copy_from_slice(&p);
    }
    pub fn is_empty(&self) -> bool {
        self.width == 0 || self.height == 0
    }
}

/// Decode a PNG / JPG / WebP / SVG into RGBA. SVGs are rasterised with the
/// longest edge at `SVG_RASTER_PX`.
pub fn load_bitmap(path: &Path) -> Result<Bitmap> {
    let ext = path.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
    let data = std::fs::read(path).with_context(|| format!("read {}", path.display()))?;
    if ext == "svg" {
        return rasterize_svg(&data, SVG_RASTER_PX);
    }
    let img = image::load_from_memory(&data).with_context(|| format!("decode {}", path.display()))?.to_rgba8();
    Ok(Bitmap { width: img.width(), height: img.height(), rgba: img.into_raw() })
}

static SERIF_FONT: &[u8] = include_bytes!("../../isoline/assets/fonts/LiberationSerif-Regular.ttf");

pub fn rasterize_svg(data: &[u8], max_edge: u32) -> Result<Bitmap> {
    let mut opt = resvg::usvg::Options::default();
    {
        let db = opt.fontdb_mut();
        db.load_font_data(SERIF_FONT.to_vec());
        db.set_serif_family("Liberation Serif");
        db.set_sans_serif_family("Liberation Serif");
    }
    let tree = resvg::usvg::Tree::from_data(data, &opt).context("parse svg")?;
    let size = tree.size();
    let (sw, sh) = (size.width().max(1.0), size.height().max(1.0));
    let scale = max_edge as f32 / sw.max(sh);
    let w = (sw * scale).ceil().max(1.0) as u32;
    let h = (sh * scale).ceil().max(1.0) as u32;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(w, h).context("pixmap")?;
    resvg::render(&tree, resvg::tiny_skia::Transform::from_scale(scale, scale), &mut pixmap.as_mut());
    // tiny-skia stores premultiplied RGBA; convert to straight alpha.
    let mut rgba = pixmap.take();
    for px in rgba.chunks_exact_mut(4) {
        let a = px[3] as u32;
        if a > 0 && a < 255 {
            for c in px.iter_mut().take(3) {
                *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
    Ok(Bitmap { width: w, height: h, rgba })
}

/// Crop away fully transparent margins (alpha ≤ `threshold`).
pub fn trim_transparent(b: &Bitmap, threshold: u8) -> Bitmap {
    let (mut x0, mut y0, mut x1, mut y1) = (b.width, b.height, 0u32, 0u32);
    for y in 0..b.height {
        for x in 0..b.width {
            if b.px(x, y)[3] > threshold {
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x + 1);
                y1 = y1.max(y + 1);
            }
        }
    }
    if x1 <= x0 || y1 <= y0 {
        return Bitmap::new(0, 0);
    }
    let mut out = Bitmap::new(x1 - x0, y1 - y0);
    for y in y0..y1 {
        for x in x0..x1 {
            out.set(x - x0, y - y0, b.px(x, y));
        }
    }
    out
}

/// True when no pixel is transparent (a scan or a JPG-like PNG).
pub fn is_fully_opaque(b: &Bitmap) -> bool {
    b.rgba.chunks_exact(4).all(|p| p[3] == 255)
}

/// Background removal: pixels with alpha below `alpha_threshold` become
/// transparent, and pixels close to `key` (within `tolerance` in RGB
/// distance 0..1) fade out. `key = None` samples the four corners.
pub fn remove_background(b: &mut Bitmap, alpha_threshold: u8, key: Option<[u8; 3]>, tolerance: f32) {
    let key = key.unwrap_or_else(|| {
        let c = [b.px(0, 0), b.px(b.width - 1, 0), b.px(0, b.height - 1), b.px(b.width - 1, b.height - 1)];
        let mut sum = [0u32; 3];
        for p in c {
            for k in 0..3 {
                sum[k] += p[k] as u32;
            }
        }
        [(sum[0] / 4) as u8, (sum[1] / 4) as u8, (sum[2] / 4) as u8]
    });
    let tol = (tolerance.clamp(0.0, 1.0) * 255.0 * 1.732).max(1.0);
    for y in 0..b.height {
        for x in 0..b.width {
            let mut p = b.px(x, y);
            if p[3] < alpha_threshold {
                p[3] = 0;
            } else {
                let d = ((p[0] as f32 - key[0] as f32).powi(2) + (p[1] as f32 - key[1] as f32).powi(2) + (p[2] as f32 - key[2] as f32).powi(2)).sqrt();
                if d < tol {
                    // Soft edge over the last 35 % of the tolerance.
                    let t = (d / tol).clamp(0.0, 1.0);
                    let a = ((t - 0.65) / 0.35).clamp(0.0, 1.0);
                    p[3] = (p[3] as f32 * a) as u8;
                }
            }
            b.set(x, y, p);
        }
    }
}

/// Nearest-neighbour-free downscale (box filter) to fit within `max_edge`.
pub fn fit_within(b: &Bitmap, max_edge: u32) -> Bitmap {
    let longest = b.width.max(b.height);
    if longest <= max_edge || b.is_empty() {
        return b.clone();
    }
    let s = max_edge as f32 / longest as f32;
    let w = ((b.width as f32 * s).round() as u32).max(1);
    let h = ((b.height as f32 * s).round() as u32).max(1);
    let mut out = Bitmap::new(w, h);
    for y in 0..h {
        let sy0 = (y as f32 / s) as u32;
        let sy1 = (((y + 1) as f32 / s) as u32).min(b.height).max(sy0 + 1);
        for x in 0..w {
            let sx0 = (x as f32 / s) as u32;
            let sx1 = (((x + 1) as f32 / s) as u32).min(b.width).max(sx0 + 1);
            let mut acc = [0u32; 4];
            let mut n = 0;
            for yy in sy0..sy1 {
                for xx in sx0..sx1 {
                    let p = b.px(xx, yy);
                    // Weight colour by alpha so transparent texels do not darken edges.
                    acc[0] += p[0] as u32 * p[3] as u32;
                    acc[1] += p[1] as u32 * p[3] as u32;
                    acc[2] += p[2] as u32 * p[3] as u32;
                    acc[3] += p[3] as u32;
                    n += 1;
                }
            }
            let a = acc[3];
            let px = if a == 0 { [0, 0, 0, 0] } else { [(acc[0] / a) as u8, (acc[1] / a) as u8, (acc[2] / a) as u8, (a / n) as u8] };
            out.set(x, y, px);
        }
    }
    out
}

/// Where to look for the packs that ship with the app.
/// The default symbol pack, name languages and example themes, built into
/// the executable so the program never depends on a folder beside it.
static EMBEDDED_ASSETS: include_dir::Dir<'_> = include_dir::include_dir!("$CARGO_MANIFEST_DIR/../../assets");

fn embedded_stamp() -> u64 {
    // FNV over every embedded path and size: a new build with changed
    // assets gets a fresh extraction folder.
    fn walk(d: &include_dir::Dir<'_>, h: &mut u64) {
        for f in d.files() {
            for b in f.path().to_string_lossy().bytes().chain(f.contents().len().to_le_bytes()) {
                *h ^= b as u64;
                *h = h.wrapping_mul(0x0000_0100_0000_01B3);
            }
        }
        for sub in d.dirs() {
            walk(sub, h);
        }
    }
    let mut h = 0xcbf2_9ce4_8422_2325u64;
    walk(&EMBEDDED_ASSETS, &mut h);
    h
}

/// Where the built-in assets live on disk: extracted from the executable
/// into the user's local data folder on first run (and again whenever the
/// build's assets change). Returns the folder holding `packs/`, `cultures/`
/// and `themes/`.
pub fn embedded_assets_dir() -> Option<PathBuf> {
    static DIR: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();
    DIR.get_or_init(|| {
        let base = dirs::data_local_dir().or_else(|| dirs::cache_dir()).or_else(|| Some(std::env::temp_dir()))?;
        let dir = base.join("isoline").join("builtin-assets").join(format!("{:016x}", embedded_stamp()));
        let marker = dir.join(".complete");
        if !marker.is_file() {
            fn extract(d: &include_dir::Dir<'_>, root: &Path) -> std::io::Result<()> {
                for f in d.files() {
                    let target = root.join(f.path());
                    if let Some(parent) = target.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    std::fs::write(&target, f.contents())?;
                }
                for sub in d.dirs() {
                    extract(sub, root)?;
                }
                Ok(())
            }
            if let Err(e) = extract(&EMBEDDED_ASSETS, &dir).and_then(|_| std::fs::write(&marker, b"ok")) {
                log::warn!("could not extract built-in assets to {}: {e}", dir.display());
                return None;
            }
            log::info!("built-in assets extracted to {}", dir.display());
        }
        Some(dir)
    })
    .clone()
}

/// Folders holding asset packs: next to the executable, in the source tree
/// during development, and the built-in copy.
pub fn builtin_pack_dirs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(p) = std::env::var("ISOLINE_ASSETS") {
        out.push(PathBuf::from(p).join("packs"));
    }
    if let Ok(exe) = std::env::current_exe() {
        for anc in exe.ancestors().take(4) {
            let p = anc.join("assets").join("packs");
            if p.is_dir() {
                out.push(p);
            }
        }
    }
    #[cfg(debug_assertions)]
    {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../assets/packs");
        if src.is_dir() {
            out.push(src);
        }
    }
    if let Some(e) = embedded_assets_dir() {
        out.push(e.join("packs"));
    }
    let mut seen = std::collections::HashSet::new();
    out.into_iter().filter_map(|p| p.canonicalize().ok()).filter(|p| seen.insert(p.clone())).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_pack_loads_and_rasterises() {
        let dirs = builtin_pack_dirs();
        let dir = dirs.iter().map(|d| d.join("default")).find(|d| d.is_dir()).expect("default pack present");
        let pack = load_pack(&dir).unwrap();
        assert!(pack.assets.len() >= 40, "{} assets", pack.assets.len());
        assert!(pack.assets.iter().any(|a| a.id == "mountain_1"));
        let a = pack.assets.iter().find(|a| a.id == "conifer_1").unwrap();
        let bm = load_bitmap(&pack.asset_path(a)).unwrap();
        assert_eq!(bm.height, SVG_RASTER_PX);
        let opaque = bm.rgba.chunks_exact(4).filter(|p| p[3] > 0).count();
        assert!(opaque > 100);
        let t = trim_transparent(&bm, 8);
        assert!(t.width <= bm.width && t.height <= bm.height && !t.is_empty());
    }

    #[test]
    fn chroma_key_clears_background() {
        let mut b = Bitmap::new(8, 8);
        for y in 0..8 {
            for x in 0..8 {
                b.set(x, y, if (2..6).contains(&x) && (2..6).contains(&y) { [200, 30, 30, 255] } else { [250, 250, 250, 255] });
            }
        }
        remove_background(&mut b, 1, None, 0.1);
        assert_eq!(b.px(0, 0)[3], 0);
        assert_eq!(b.px(3, 3)[3], 255);
        let t = trim_transparent(&b, 0);
        assert_eq!((t.width, t.height), (4, 4));
        let small = fit_within(&t, 2);
        assert_eq!((small.width, small.height), (2, 2));
    }
}
