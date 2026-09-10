//! The runtime asset library: registered pack folders, rasterised bitmaps,
//! the GPU atlas, search, favourites, recents and directory watching.

use crate::gpu::sprites::{Atlas, AtlasRect};
use anyhow::{Context, Result};
use isoline_core::assets::{self, AssetDef, Bitmap, Pack};
use isoline_core::placement::SymbolSets;
use notify::Watcher;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Receiver};
use std::time::{Duration, Instant};

/// Persisted per-user library state.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct LibraryConfig {
    #[serde(default)]
    pub pack_dirs: Vec<PathBuf>,
    #[serde(default)]
    pub favorites: Vec<String>,
    #[serde(default)]
    pub recent: Vec<String>,
}

impl LibraryConfig {
    pub fn path() -> Option<PathBuf> {
        dirs::config_dir().map(|d| d.join("isoline").join("library.json"))
    }
    pub fn load() -> Self {
        Self::path().and_then(|p| std::fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }
    pub fn save(&self) {
        if let Some(p) = Self::path() {
            if let Some(parent) = p.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            if let Ok(t) = serde_json::to_string_pretty(self) {
                let _ = std::fs::write(p, t);
            }
        }
    }
}

/// One loaded asset with its atlas placement.
#[derive(Clone, Debug)]
pub struct LibraryAsset {
    pub qid: String,
    pub pack: String,
    pub def: AssetDef,
    #[allow(dead_code)]
    pub path: PathBuf,
    pub rect: Option<AtlasRect>,
    /// Bitmap aspect (w/h) for sizing.
    pub aspect: f32,
}

pub struct Library {
    pub config: LibraryConfig,
    pub packs: Vec<Pack>,
    pub assets: Vec<LibraryAsset>,
    by_id: HashMap<String, usize>,
    /// Folders watched for hot reload (built-in, user, project).
    watched: Vec<PathBuf>,
    project_dir: Option<PathBuf>,
    watcher: Option<notify::RecommendedWatcher>,
    events: Option<Receiver<notify::Result<notify::Event>>>,
    pending_reload: Option<Instant>,
    pub generation: u64,
    pub last_load_ms: f32,
    pub overflow: usize,
}

impl Library {
    pub fn new() -> Self {
        Self {
            config: LibraryConfig::load(),
            packs: Vec::new(),
            assets: Vec::new(),
            by_id: HashMap::new(),
            watched: Vec::new(),
            project_dir: None,
            watcher: None,
            events: None,
            pending_reload: None,
            generation: 0,
            last_load_ms: 0.0,
            overflow: 0,
        }
    }

    /// Pack folders in load order: built-in, user-registered, project assets.
    pub fn pack_dirs(&self) -> Vec<PathBuf> {
        let mut out = Vec::new();
        for base in assets::builtin_pack_dirs() {
            if let Ok(rd) = std::fs::read_dir(&base) {
                let mut v: Vec<PathBuf> = rd.flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
                v.sort();
                out.extend(v);
            }
        }
        out.extend(self.config.pack_dirs.iter().cloned());
        if let Some(p) = &self.project_dir {
            let a = p.join("assets");
            if a.is_dir() {
                out.push(a);
            }
        }
        let mut seen = HashSet::new();
        out.retain(|p| seen.insert(p.clone()));
        out
    }

    pub fn set_project_dir(&mut self, dir: Option<PathBuf>) {
        if self.project_dir != dir {
            self.project_dir = dir;
            self.pending_reload = Some(Instant::now());
        }
    }

    pub fn register_pack_dir(&mut self, dir: PathBuf) {
        if !self.config.pack_dirs.contains(&dir) {
            self.config.pack_dirs.push(dir);
            self.config.save();
            self.pending_reload = Some(Instant::now());
        }
    }

    pub fn unregister_pack_dir(&mut self, dir: &Path) {
        self.config.pack_dirs.retain(|p| p != dir);
        self.config.save();
        self.pending_reload = Some(Instant::now());
    }

    /// (Re)load every pack, rasterise, and rebuild the atlas.
    pub fn reload(&mut self, atlas: &mut Atlas, queue: &wgpu::Queue) {
        let t = Instant::now();
        self.packs.clear();
        self.assets.clear();
        self.by_id.clear();
        self.overflow = 0;
        atlas.clear();
        let dirs = self.pack_dirs();
        let project_assets = self.project_dir.as_ref().map(|p| p.join("assets"));
        for dir in &dirs {
            match assets::load_pack(dir) {
                Ok(mut pack) => {
                    if project_assets.as_deref() == Some(dir.as_path()) {
                        pack.pack_id = "project".into();
                        pack.manifest.name = "Project assets".into();
                    }
                    for def in &pack.assets {
                        let qid = assets::qualified_id(&pack.pack_id, &def.id);
                        let path = pack.asset_path(def);
                        let bm = match assets::load_bitmap(&path) {
                            Ok(b) => assets::trim_transparent(&b, 4),
                            Err(e) => {
                                log::warn!("asset {}: {e:#}", path.display());
                                continue;
                            }
                        };
                        let bm = assets::fit_within(&bm, 256);
                        let aspect = bm.width as f32 / bm.height.max(1) as f32;
                        let rect = atlas.insert(&qid, &bm).or_else(|| {
                            // Atlas full: try a smaller copy.
                            let small = assets::fit_within(&bm, 96);
                            atlas.insert(&qid, &small)
                        });
                        if rect.is_none() {
                            self.overflow += 1;
                        }
                        self.by_id.insert(qid.clone(), self.assets.len());
                        self.assets.push(LibraryAsset { qid, pack: pack.pack_id.clone(), def: def.clone(), path, rect, aspect });
                    }
                    self.packs.push(pack);
                }
                Err(e) => log::warn!("pack {}: {e:#}", dir.display()),
            }
        }
        atlas.upload(queue);
        self.install_watchers(&dirs);
        self.generation += 1;
        self.last_load_ms = t.elapsed().as_secs_f32() * 1000.0;
        log::info!("library: {} packs, {} assets in {:.0} ms", self.packs.len(), self.assets.len(), self.last_load_ms);
    }

    fn install_watchers(&mut self, dirs: &[PathBuf]) {
        if self.watched == dirs {
            return;
        }
        let (tx, rx) = channel();
        let mut watcher = match notify::recommended_watcher(move |ev| {
            let _ = tx.send(ev);
        }) {
            Ok(w) => w,
            Err(e) => {
                log::warn!("directory watcher unavailable: {e}");
                return;
            }
        };
        for d in dirs {
            if let Err(e) = watcher.watch(d, notify::RecursiveMode::Recursive) {
                log::warn!("watch {}: {e}", d.display());
            }
        }
        self.watcher = Some(watcher);
        self.events = Some(rx);
        self.watched = dirs.to_vec();
    }

    /// Poll the watcher; returns true when a reload is due (debounced).
    pub fn poll(&mut self) -> bool {
        if let Some(rx) = &self.events {
            let mut any = false;
            while let Ok(ev) = rx.try_recv() {
                if let Ok(ev) = ev {
                    // Our own reads show up as access events; only real changes count.
                    if matches!(ev.kind, notify::EventKind::Access(_)) {
                        continue;
                    }
                    if ev.paths.iter().any(|p| {
                        let ext = p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
                        assets::IMAGE_EXTENSIONS.contains(&ext.as_str()) || p.file_name().map(|n| n == assets::PACK_MANIFEST).unwrap_or(false)
                    }) {
                        any = true;
                    }
                }
            }
            if any {
                self.pending_reload = Some(Instant::now());
            }
        }
        match self.pending_reload {
            Some(t) if t.elapsed() >= Duration::from_millis(400) => {
                self.pending_reload = None;
                true
            }
            _ => false,
        }
    }

    pub fn get(&self, qid: &str) -> Option<&LibraryAsset> {
        self.by_id.get(qid).map(|&i| &self.assets[i])
    }

    pub fn categories(&self) -> Vec<String> {
        let mut v: Vec<String> = self.assets.iter().map(|a| a.def.category.clone()).filter(|c| !c.is_empty()).collect();
        v.sort();
        v.dedup();
        v
    }

    /// Case-insensitive search over name, id, tags and category.
    pub fn search<'a>(&'a self, query: &str, category: Option<&str>, favorites_only: bool) -> Vec<&'a LibraryAsset> {
        let q = query.trim().to_ascii_lowercase();
        let terms: Vec<&str> = q.split_whitespace().collect();
        self.assets
            .iter()
            .filter(|a| category.map(|c| a.def.category == c).unwrap_or(true))
            .filter(|a| !favorites_only || self.config.favorites.contains(&a.qid))
            .filter(|a| {
                terms.iter().all(|t| {
                    a.def.name.to_ascii_lowercase().contains(t) || a.def.id.contains(t) || a.def.category.contains(t) || a.def.tags.iter().any(|g| g.contains(t)) || a.pack.contains(t)
                })
            })
            .collect()
    }

    pub fn toggle_favorite(&mut self, qid: &str) {
        if let Some(i) = self.config.favorites.iter().position(|f| f == qid) {
            self.config.favorites.remove(i);
        } else {
            self.config.favorites.push(qid.to_string());
        }
        self.config.save();
    }

    pub fn touch_recent(&mut self, qid: &str) {
        self.config.recent.retain(|r| r != qid);
        self.config.recent.insert(0, qid.to_string());
        self.config.recent.truncate(16);
        self.config.save();
    }

    /// Asset ids for the automatic layers, from tags. `prefer_ink` picks
    /// ink-only tree variants (paper fill) when the pack offers them.
    pub fn symbol_sets(&self, prefer_ink: bool) -> SymbolSets {
        let mut s = SymbolSets::default();
        let mut ink_conifers = Vec::new();
        let mut ink_broadleaf = Vec::new();
        for a in &self.assets {
            if a.rect.is_none() {
                continue;
            }
            let tags = &a.def.tags;
            let has = |t: &str| tags.iter().any(|g| g == t);
            let entry = (a.qid.clone(), a.def.world_size);
            if has("mountain") && !has("range") {
                if has("snow") {
                    s.snow_mountains.push(entry.clone());
                } else {
                    s.mountains.push(entry.clone());
                }
            } else if has("hill") && !has("cluster") {
                s.hills.push(entry.clone());
            } else if has("tree") {
                if has("palm") {
                    s.palms.push(entry.clone());
                } else if has("dead") {
                    s.dead.push(entry.clone());
                } else if has("conifer") && has("ink") {
                    ink_conifers.push(entry.clone());
                } else if has("broadleaf") && has("ink") {
                    ink_broadleaf.push(entry.clone());
                } else if has("conifer") && !has("winter") {
                    s.conifers.push(entry.clone());
                } else if has("broadleaf") && !has("autumn") {
                    s.broadleaf.push(entry.clone());
                }
            }
        }
        if prefer_ink {
            if !ink_conifers.is_empty() {
                s.conifers = ink_conifers;
            }
            if !ink_broadleaf.is_empty() {
                s.broadleaf = ink_broadleaf;
            }
        }
        s
    }

    /// Import an image into the project's `assets/` folder as a new asset.
    pub fn import_image(&mut self, src: &Path, trim: bool, remove_bg: bool, tolerance: f32) -> Result<PathBuf> {
        let project = self.project_dir.clone().context("open or save the project before importing assets")?;
        let dir = project.join("assets").join("imported");
        std::fs::create_dir_all(&dir)?;
        let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "asset".into());
        let ext = src.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).unwrap_or_default();
        let dst = if ext == "svg" {
            let dst = dir.join(format!("{stem}.svg"));
            std::fs::copy(src, &dst)?;
            dst
        } else {
            let mut bm = assets::load_bitmap(src)?;
            if remove_bg || assets::is_fully_opaque(&bm) {
                assets::remove_background(&mut bm, 8, None, tolerance);
            }
            if trim {
                bm = assets::trim_transparent(&bm, 4);
            }
            if bm.is_empty() {
                anyhow::bail!("image is empty after trimming");
            }
            let dst = dir.join(format!("{stem}.png"));
            save_png(&dst, &bm)?;
            dst
        };
        self.pending_reload = Some(Instant::now() - Duration::from_secs(1));
        Ok(dst)
    }
}

fn save_png(path: &Path, b: &Bitmap) -> Result<()> {
    let file = std::fs::File::create(path)?;
    let mut enc = png::Encoder::new(std::io::BufWriter::new(file), b.width, b.height);
    enc.set_color(png::ColorType::Rgba);
    enc.set_depth(png::BitDepth::Eight);
    enc.write_header()?.write_image_data(&b.rgba)?;
    Ok(())
}
