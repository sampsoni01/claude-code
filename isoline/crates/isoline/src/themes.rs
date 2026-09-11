//! Theme files: the three built-in looks plus any JSON theme in the bundled
//! `assets/themes` folder or the user's config folder. A theme is the
//! whole `Theme` struct serialized, so users author and share them as text.

use anyhow::{Context, Result};
use isoline_core::theme::{Theme, ThemeStyle};
use std::path::{Path, PathBuf};

pub struct ThemeLibrary {
    pub themes: Vec<Theme>,
}

fn theme_dirs() -> Vec<PathBuf> {
    let mut out = Vec::new();
    if let Ok(p) = std::env::var("ISOLINE_ASSETS") {
        out.push(PathBuf::from(p).join("themes"));
    }
    if let Ok(exe) = std::env::current_exe() {
        for anc in exe.ancestors().take(4) {
            let p = anc.join("assets").join("themes");
            if p.is_dir() {
                out.push(p);
            }
        }
    }
    #[cfg(debug_assertions)]
    {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../assets/themes");
        if src.is_dir() {
            out.push(src);
        }
    }
    if let Some(e) = isoline_core::assets::embedded_assets_dir() {
        out.push(e.join("themes"));
    }
    if let Some(u) = user_dir() {
        out.push(u);
    }
    let mut seen = Vec::new();
    out.retain(|d| {
        let c = d.canonicalize().unwrap_or(d.clone());
        if seen.contains(&c) {
            false
        } else {
            seen.push(c);
            true
        }
    });
    out
}

pub fn user_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("isoline").join("themes"))
}

impl ThemeLibrary {
    pub fn load() -> Self {
        let mut themes: Vec<Theme> = ThemeStyle::ALL.iter().map(|s| Theme::preset(*s)).collect();
        for dir in theme_dirs() {
            let Ok(rd) = std::fs::read_dir(&dir) else { continue };
            let mut files: Vec<PathBuf> = rd.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().map(|e| e == "json").unwrap_or(false)).collect();
            files.sort();
            for f in files {
                match read_theme(&f) {
                    Ok(t) => {
                        if let Some(existing) = themes.iter_mut().find(|x| x.name == t.name) {
                            *existing = t;
                        } else {
                            themes.push(t);
                        }
                    }
                    Err(e) => log::warn!("theme {}: {e:#}", f.display()),
                }
            }
        }
        Self { themes }
    }

    /// Import a theme file: it joins the list and is copied into the user
    /// folder so it is there next time.
    pub fn import(&mut self, path: &Path) -> Result<Theme> {
        let t = read_theme(path)?;
        if let Some(dir) = user_dir() {
            std::fs::create_dir_all(&dir)?;
            let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "theme".into());
            let dst = dir.join(format!("{stem}.json"));
            if dst.canonicalize().ok() != path.canonicalize().ok() {
                std::fs::write(&dst, serde_json::to_vec_pretty(&t)?)?;
            }
        }
        match self.themes.iter_mut().find(|x| x.name == t.name) {
            Some(x) => *x = t.clone(),
            None => self.themes.push(t.clone()),
        }
        Ok(t)
    }
}

pub fn read_theme(path: &Path) -> Result<Theme> {
    let text = std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    serde_json::from_str(&text).with_context(|| format!("parse {}", path.display()))
}

pub fn write_theme(path: &Path, theme: &Theme) -> Result<()> {
    std::fs::write(path, serde_json::to_vec_pretty(theme)?).with_context(|| format!("write {}", path.display()))
}
