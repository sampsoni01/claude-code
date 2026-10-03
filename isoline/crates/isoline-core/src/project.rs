//! On-disk project format.
//!
//! ```text
//! MyMap.isoline/
//!   manifest.json          -- diffable text: settings, field list, view
//!   fields/elevation.f32   -- raw little-endian f32, row-major, no header
//!   autosave/              -- sidecar written periodically; recovered on open
//!     manifest.json
//!     fields/elevation.f32
//! ```
//!
//! Field blobs are memory-mapped on load so opening a project does not stall
//! on a synchronous read of the whole file.

use crate::derived::DerivedParams;
use crate::borders::{Border, Region};
use crate::entity::Entity;
use crate::field::ScalarField;
use crate::hydrology::River;
use crate::placement::{ForestParams, MountainParams, Placement};
use crate::settlement::Settlement;
use crate::theme::Theme;
use crate::water::LakePolygon;
use anyhow::{bail, Context, Result};
use serde::{Deserialize, Serialize};
#[cfg(not(target_arch = "wasm32"))]
use std::fs;
use std::io::{Read, Write};
#[cfg(not(target_arch = "wasm32"))]
use std::path::{Path, PathBuf};
use web_time::{SystemTime, UNIX_EPOCH};

pub const FORMAT: &str = "isoline-project";
pub const VERSION: u32 = 1;
pub const PROJECT_EXTENSION: &str = "isoline";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct FieldEntry {
    pub name: String,
    pub file: String,
    pub dtype: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct ViewState {
    pub center: [f32; 2],
    pub zoom: f32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct RenderSettings {
    pub sun_azimuth_deg: f32,
    pub sun_altitude_deg: f32,
    pub hillshade_strength: f32,
    pub vertical_exaggeration: f32,
    pub contour_interval: f32,
    pub show_contours: bool,
    pub coast_line_width: f32,
    #[serde(default)]
    pub theme: Theme,
    /// Display-only grid overlay (never a data structure).
    #[serde(default)]
    pub grid: GridSettings,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum GridKind {
    #[default]
    None,
    Square,
    Hex,
}

impl GridKind {
    pub const ALL: [GridKind; 3] = [GridKind::None, GridKind::Square, GridKind::Hex];
    pub fn label(self) -> &'static str {
        match self {
            GridKind::None => "None",
            GridKind::Square => "Square",
            GridKind::Hex => "Hex",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct GridSettings {
    pub kind: GridKind,
    /// Cell size in texels (hex: flat-to-flat).
    pub spacing: f32,
}

impl Default for GridSettings {
    fn default() -> Self {
        Self { kind: GridKind::None, spacing: 64.0 }
    }
}

impl Default for RenderSettings {
    fn default() -> Self {
        Self {
            sun_azimuth_deg: 315.0,
            sun_altitude_deg: 40.0,
            hillshade_strength: 0.75,
            vertical_exaggeration: 1.0,
            contour_interval: 250.0,
            show_contours: false,
            coast_line_width: 1.4,
            theme: Theme::default(),
            grid: GridSettings::default(),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Manifest {
    pub format: String,
    pub version: u32,
    pub name: String,
    pub width: u32,
    pub height: u32,
    pub sea_level: f32,
    /// World scale, so brushes and later hydrology can reason in metres.
    pub meters_per_texel: f32,
    pub fields: Vec<FieldEntry>,
    pub view: ViewState,
    pub render: RenderSettings,
    #[serde(default)]
    pub derived: DerivedParams,
    #[serde(default)]
    pub symbols: SymbolParams,
    /// Culture pack id used for generated names.
    #[serde(default = "default_culture")]
    pub culture: String,
    pub saved_at_unix: u64,
    pub saved_at: String,
}

impl Manifest {
    pub fn new(name: &str, width: u32, height: u32) -> Self {
        Self {
            format: FORMAT.into(),
            version: VERSION,
            name: name.into(),
            width,
            height,
            sea_level: 0.0,
            meters_per_texel: 100.0,
            fields: vec![],
            view: ViewState { center: [width as f32 / 2.0, height as f32 / 2.0], zoom: 0.0 },
            render: RenderSettings::default(),
            derived: DerivedParams::default(),
            symbols: SymbolParams::default(),
            culture: default_culture(),
            saved_at_unix: 0,
            saved_at: String::new(),
        }
    }
}

/// Automatic symbol layers.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SymbolParams {
    pub mountains: MountainParams,
    pub forest: ForestParams,
    /// Drop shadow strength for symbols.
    #[serde(default = "default_shadow")]
    pub shadow: f32,
}

fn default_shadow() -> f32 {
    0.12
}

fn default_culture() -> String {
    "northern".into()
}

impl Default for SymbolParams {
    fn default() -> Self {
        Self { mountains: MountainParams::default(), forest: ForestParams::default(), shadow: default_shadow() }
    }
}

/// Everything needed to save or restore a project.
#[derive(Clone, Debug)]
pub struct ProjectData {
    pub manifest: Manifest,
    pub fields: Vec<(String, ScalarField)>,
    /// Derived vector geometry, written for other tools to read; the app
    /// recomputes it from the fields on load.
    pub geometry: Geometry,
    /// Project asset files (path relative to the project's `assets` folder,
    /// bytes). Filled by archives; on disk the folder itself holds them.
    pub assets: Vec<(String, Vec<u8>)>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Geometry {
    #[serde(default)]
    pub rivers: Vec<River>,
    #[serde(default)]
    pub lakes: Vec<LakePolygon>,
    /// True when the geometry (and the `moisture` field) is user-owned.
    #[serde(default)]
    pub baked: bool,
    /// Manual symbol placements.
    #[serde(default)]
    pub placements: Vec<Placement>,
    /// Named entities and their labels.
    #[serde(default)]
    pub entities: Vec<Entity>,
    /// Realms and the borders between them (and borders drawn by hand).
    #[serde(default)]
    pub regions: Vec<Region>,
    #[serde(default)]
    pub borders: Vec<Border>,
    /// Towns with their generated, editable layouts.
    #[serde(default)]
    pub settlements: Vec<Settlement>,
}

fn now_unix() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// UTC ISO-8601 timestamp without pulling in a date crate.
pub fn iso_utc(secs: u64) -> String {
    let days = (secs / 86400) as i64;
    let rem = secs % 86400;
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, (rem % 3600) / 60, rem % 60)
}

#[cfg(not(target_arch = "wasm32"))]
fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let tmp = path.with_extension("tmp");
    {
        let mut f = fs::File::create(&tmp).with_context(|| format!("create {}", tmp.display()))?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path).with_context(|| format!("rename into {}", path.display()))?;
    Ok(())
}

/// Write a project to `dir` (created if missing). Field blobs are written
/// first, then the manifest, each via rename so a crash never leaves a
/// half-written manifest pointing at a half-written blob.
#[cfg(not(target_arch = "wasm32"))]
pub fn save(dir: &Path, data: &ProjectData) -> Result<()> {
    fs::create_dir_all(dir.join("fields")).with_context(|| format!("create {}", dir.display()))?;
    let manifest = manifest_for_save(data);
    for (entry, (_, field)) in manifest.fields.iter().zip(&data.fields) {
        write_atomic(&dir.join(&entry.file), bytemuck::cast_slice(field.data()))?;
    }
    let geom = serde_json::to_vec(&data.geometry)?;
    write_atomic(&dir.join("geometry.json"), &geom)?;
    for (rel, bytes) in &data.assets {
        let p = dir.join("assets").join(rel);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent)?;
        }
        write_atomic(&p, bytes)?;
    }
    let json = serde_json::to_vec_pretty(&manifest)?;
    write_atomic(&dir.join("manifest.json"), &json)?;
    Ok(())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn read_manifest(dir: &Path) -> Result<Manifest> {
    let path = dir.join("manifest.json");
    let text = fs::read_to_string(&path).with_context(|| format!("read {}", path.display()))?;
    parse_manifest(&text)
}

fn parse_manifest(text: &str) -> Result<Manifest> {
    let m: Manifest = serde_json::from_str(text).context("parse manifest.json")?;
    if m.format != FORMAT {
        bail!("not an Isoline project (format = {:?})", m.format);
    }
    if m.version > VERSION {
        bail!("project version {} is newer than this build supports ({})", m.version, VERSION);
    }
    Ok(m)
}

/// Field bytes (little-endian f32) to a field, checking the size.
fn field_from_bytes(entry: &FieldEntry, bytes: &[u8]) -> Result<ScalarField> {
    if entry.dtype != "f32" {
        bail!("unsupported field dtype {:?}", entry.dtype);
    }
    let expected = entry.width as usize * entry.height as usize * 4;
    if bytes.len() != expected {
        bail!("{} is {} bytes, expected {expected} for {}x{}", entry.file, bytes.len(), entry.width, entry.height);
    }
    let mut data = vec![0f32; entry.width as usize * entry.height as usize];
    {
        use rayon::prelude::*;
        let chunk = 1 << 18; // texels
        data.par_chunks_mut(chunk).enumerate().for_each(|(i, dst)| {
            let off = i * chunk * 4;
            let src = &bytes[off..off + dst.len() * 4];
            for (d, s) in dst.iter_mut().zip(src.chunks_exact(4)) {
                *d = f32::from_le_bytes([s[0], s[1], s[2], s[3]]);
            }
        });
    }
    Ok(ScalarField::from_vec(entry.width, entry.height, data))
}

fn manifest_for_save(data: &ProjectData) -> Manifest {
    let mut manifest = data.manifest.clone();
    manifest.format = FORMAT.into();
    manifest.version = VERSION;
    manifest.fields = data
        .fields
        .iter()
        .map(|(name, field)| FieldEntry { name: name.clone(), file: format!("fields/{name}.f32"), dtype: "f32".into(), width: field.width(), height: field.height() })
        .collect();
    manifest.saved_at_unix = now_unix();
    manifest.saved_at = iso_utc(manifest.saved_at_unix);
    manifest
}

// ---- single-file archive ---------------------------------------------------

/// Extension of the single-file form of a project (a zip of the folder layout).
pub const ARCHIVE_EXTENSION: &str = "isoline.zip";

/// Pack a project into one zip file with the same layout as a project
/// folder. `compress` trades time for size: stored entries are fast, which
/// autosaves want; deflated ones are small, which downloads want.
pub fn pack_archive(data: &ProjectData, compress: bool) -> Result<Vec<u8>> {
    use zip::write::SimpleFileOptions;
    let manifest = manifest_for_save(data);
    let method = if compress { zip::CompressionMethod::Deflated } else { zip::CompressionMethod::Stored };
    let opts = SimpleFileOptions::default().compression_method(method).compression_level(if compress { Some(1) } else { None }).large_file(true);
    let mut zw = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    zw.start_file("manifest.json", opts)?;
    zw.write_all(&serde_json::to_vec_pretty(&manifest)?)?;
    zw.start_file("geometry.json", opts)?;
    zw.write_all(&serde_json::to_vec(&data.geometry)?)?;
    for (entry, (_, field)) in manifest.fields.iter().zip(&data.fields) {
        zw.start_file(&entry.file, opts)?;
        zw.write_all(bytemuck::cast_slice(field.data()))?;
    }
    for (rel, bytes) in &data.assets {
        zw.start_file(format!("assets/{}", rel.replace('\\', "/")), opts)?;
        zw.write_all(bytes)?;
    }
    Ok(zw.finish()?.into_inner())
}

/// Read a project archive written by `pack_archive` (or a zipped folder).
pub fn unpack_archive(bytes: &[u8]) -> Result<ProjectData> {
    let mut za = zip::ZipArchive::new(std::io::Cursor::new(bytes)).context("not a zip file")?;
    // Allow a zipped folder: everything may sit under one top-level directory.
    let prefix = {
        let names: Vec<String> = za.file_names().map(|n| n.to_string()).collect();
        if names.iter().any(|n| n == "manifest.json") {
            String::new()
        } else {
            names.iter().find(|n| n.ends_with("/manifest.json")).map(|n| n[..n.len() - "manifest.json".len()].to_string()).context("no manifest.json in the archive")?
        }
    };
    let read = |za: &mut zip::ZipArchive<std::io::Cursor<&[u8]>>, name: &str| -> Result<Vec<u8>> {
        let mut f = za.by_name(&format!("{prefix}{name}")).with_context(|| format!("{name} missing from the archive"))?;
        let mut v = Vec::with_capacity(f.size() as usize);
        f.read_to_end(&mut v)?;
        Ok(v)
    };
    let manifest = parse_manifest(&String::from_utf8_lossy(&read(&mut za, "manifest.json")?))?;
    let mut fields = Vec::new();
    for entry in &manifest.fields {
        let bytes = read(&mut za, &entry.file.replace('\\', "/"))?;
        fields.push((entry.name.clone(), field_from_bytes(entry, &bytes)?));
    }
    let geometry = read(&mut za, "geometry.json").ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default();
    let mut assets = Vec::new();
    let asset_names: Vec<String> = za.file_names().filter(|n| n.starts_with(&format!("{prefix}assets/")) && !n.ends_with('/')).map(|n| n.to_string()).collect();
    for name in asset_names {
        let rel = name[prefix.len() + "assets/".len()..].to_string();
        let bytes = read(&mut za, &name[prefix.len()..])?;
        assets.push((rel, bytes));
    }
    Ok(ProjectData { manifest, fields, geometry, assets })
}

/// Load a project directory. Field blobs are read whole and converted in
/// parallel chunks. Project assets stay on disk (the folder is the pack).
#[cfg(not(target_arch = "wasm32"))]
pub fn load(dir: &Path) -> Result<ProjectData> {
    let manifest = read_manifest(dir)?;
    let mut fields = Vec::new();
    for entry in &manifest.fields {
        let path = dir.join(&entry.file);
        let bytes = fs::read(&path).with_context(|| format!("read {}", path.display()))?;
        fields.push((entry.name.clone(), field_from_bytes(entry, &bytes)?));
    }
    let geometry = fs::read_to_string(dir.join("geometry.json"))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    Ok(ProjectData { manifest, fields, geometry, assets: Vec::new() })
}

// ---- autosave / recovery -------------------------------------------------

#[cfg(not(target_arch = "wasm32"))]
pub fn autosave_dir(project_dir: &Path) -> PathBuf {
    project_dir.join("autosave")
}

/// Where autosaves of never-saved projects go.
#[cfg(not(target_arch = "wasm32"))]
pub fn untitled_autosave_dir() -> PathBuf {
    std::env::temp_dir().join("isoline").join("untitled-autosave")
}

#[cfg(not(target_arch = "wasm32"))]
pub fn autosave(project_dir: Option<&Path>, data: &ProjectData) -> Result<PathBuf> {
    let dir = match project_dir {
        Some(p) => autosave_dir(p),
        None => untitled_autosave_dir(),
    };
    save(&dir, data)?;
    Ok(dir)
}

/// If an autosave exists that is newer than the saved manifest, return it.
#[cfg(not(target_arch = "wasm32"))]
pub fn pending_recovery(project_dir: &Path) -> Option<(PathBuf, Manifest)> {
    let dir = autosave_dir(project_dir);
    let auto = read_manifest(&dir).ok()?;
    let main_saved = read_manifest(project_dir).map(|m| m.saved_at_unix).unwrap_or(0);
    if auto.saved_at_unix > main_saved {
        Some((dir, auto))
    } else {
        None
    }
}

#[cfg(not(target_arch = "wasm32"))]
pub fn pending_untitled_recovery() -> Option<(PathBuf, Manifest)> {
    let dir = untitled_autosave_dir();
    let m = read_manifest(&dir).ok()?;
    Some((dir, m))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn discard_autosave(project_dir: Option<&Path>) {
    let dir = match project_dir {
        Some(p) => autosave_dir(p),
        None => untitled_autosave_dir(),
    };
    let _ = fs::remove_dir_all(dir);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_timestamp() {
        assert_eq!(iso_utc(0), "1970-01-01T00:00:00Z");
        assert_eq!(iso_utc(1_700_000_000), "2023-11-14T22:13:20Z");
    }

    #[test]
    fn archive_round_trip() {
        let mut f = ScalarField::new(70, 40, 0.0);
        f.par_map_inplace(|x, y, _| x as f32 - y as f32 * 0.25);
        let mut m = Manifest::new("arc", 70, 40);
        m.sea_level = 3.0;
        let data = ProjectData { manifest: m, fields: vec![("elevation".into(), f.clone())], geometry: Geometry::default(), assets: vec![("imported/a.png".into(), vec![9, 8, 7])] };
        for compress in [false, true] {
            let bytes = pack_archive(&data, compress).unwrap();
            let back = unpack_archive(&bytes).unwrap();
            assert_eq!(back.manifest.sea_level, 3.0);
            assert_eq!(back.fields[0].1.data(), f.data());
            assert_eq!(back.assets, vec![("imported/a.png".to_string(), vec![9, 8, 7])]);
        }
        assert!(unpack_archive(b"not a zip").is_err());
    }

    #[test]
    #[cfg(not(target_arch = "wasm32"))]
    fn save_load_round_trip() {
        let dir = std::env::temp_dir().join(format!("isoline-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        let mut f = ScalarField::new(130, 70, 0.0);
        f.par_map_inplace(|x, y, _| x as f32 * 0.5 - y as f32);
        let mut m = Manifest::new("t", 130, 70);
        m.sea_level = 12.5;
        let data = ProjectData { manifest: m, fields: vec![("elevation".into(), f.clone())], geometry: Geometry::default(), assets: vec![("imported/x.bin".into(), vec![1, 2, 3])] };
        save(&dir, &data).unwrap();
        assert_eq!(fs::read(dir.join("assets/imported/x.bin")).unwrap(), vec![1, 2, 3]);
        let back = load(&dir).unwrap();
        assert_eq!(back.manifest.sea_level, 12.5);
        assert_eq!(back.manifest.fields.len(), 1);
        assert_eq!(back.fields[0].1.data(), f.data());
        assert!(pending_recovery(&dir).is_none());
        std::thread::sleep(std::time::Duration::from_millis(1100));
        autosave(Some(&dir), &data).unwrap();
        assert!(pending_recovery(&dir).is_some());
        discard_autosave(Some(&dir));
        assert!(pending_recovery(&dir).is_none());
        let _ = fs::remove_dir_all(&dir);
    }
}
