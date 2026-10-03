//! Theme files: the three built-in looks plus any JSON theme bundled with
//! the program, in an `assets/themes` folder next to it, or in the user's
//! config folder. A theme is the whole `Theme` struct serialized, so users
//! author and share them as text.

use anyhow::{Context, Result};
use isoline_core::theme::{Theme, ThemeStyle};
#[cfg(not(target_arch = "wasm32"))]
use std::path::{Path, PathBuf};

pub struct ThemeLibrary {
    pub themes: Vec<Theme>,
}

#[cfg(not(target_arch = "wasm32"))]
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

#[cfg(not(target_arch = "wasm32"))]
pub fn user_dir() -> Option<PathBuf> {
    dirs::config_dir().map(|d| d.join("isoline").join("themes"))
}

impl ThemeLibrary {
    fn merge(&mut self, t: Theme) {
        if let Some(existing) = self.themes.iter_mut().find(|x| x.name == t.name) {
            *existing = t;
        } else {
            self.themes.push(t);
        }
    }

    pub fn load() -> Self {
        let mut lib = Self { themes: ThemeStyle::ALL.iter().map(|s| Theme::preset(*s)).collect() };
        for (name, bytes) in isoline_core::assets::embedded_files("themes") {
            if !name.ends_with(".json") {
                continue;
            }
            match parse_theme(&String::from_utf8_lossy(bytes)) {
                Ok(t) => lib.merge(t),
                Err(e) => log::warn!("built-in theme {name}: {e:#}"),
            }
        }
        #[cfg(not(target_arch = "wasm32"))]
        for dir in theme_dirs() {
            let Ok(rd) = std::fs::read_dir(&dir) else { continue };
            let mut files: Vec<PathBuf> = rd.filter_map(|e| e.ok().map(|e| e.path())).filter(|p| p.extension().map(|e| e == "json").unwrap_or(false)).collect();
            files.sort();
            for f in files {
                match read_theme(&f) {
                    Ok(t) => lib.merge(t),
                    Err(e) => log::warn!("theme {}: {e:#}", f.display()),
                }
            }
        }
        lib
    }

    /// Import a theme from file contents: it joins the list and, on the
    /// desktop, is copied into the user folder so it is there next time.
    pub fn import_bytes(&mut self, name: &str, bytes: &[u8]) -> Result<Theme> {
        let t = parse_theme(&String::from_utf8_lossy(bytes)).with_context(|| format!("parse {name}"))?;
        #[cfg(not(target_arch = "wasm32"))]
        if let Some(dir) = user_dir() {
            std::fs::create_dir_all(&dir)?;
            let stem = name.rsplit_once('.').map(|(s, _)| s.to_string()).unwrap_or_else(|| name.to_string());
            std::fs::write(dir.join(format!("{stem}.json")), serde_json::to_vec_pretty(&t)?)?;
        }
        self.merge(t.clone());
        Ok(t)
    }
}

pub fn parse_theme(text: &str) -> Result<Theme> {
    serde_json::from_str(text).context("parse theme JSON")
}

#[cfg(not(target_arch = "wasm32"))]
pub fn read_theme(path: &Path) -> Result<Theme> {
    let text = std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
    parse_theme(&text).with_context(|| format!("in {}", path.display()))
}
