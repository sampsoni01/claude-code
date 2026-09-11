//! Name generation: character n-gram (Markov) models trained on the corpus
//! of a culture pack, with templates per feature kind so a root such as
//! "Aldwyn" becomes "River Aldwyn", "Aldwynmouth" or "Aldwyn Vale".

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// A culture pack file (`assets/cultures/*.json` or user folders).
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct CulturePack {
    pub name: String,
    #[serde(default)]
    pub description: String,
    /// Example names the model learns from. Users edit this list.
    pub corpus: Vec<String>,
    /// Templates per kind, using `{root}`.
    #[serde(default)]
    pub generics: HashMap<String, Vec<String>>,
    /// n-gram order (default 3).
    #[serde(default = "default_order")]
    pub order: usize,
}

fn default_order() -> usize {
    3
}

/// A trained model plus its templates.
#[derive(Clone, Debug)]
pub struct Culture {
    pub id: String,
    pub pack: CulturePack,
    order: usize,
    /// context (last `order` chars, padded with '^') → next char counts.
    table: HashMap<Vec<char>, Vec<(char, u32)>>,
    min_len: usize,
    max_len: usize,
}

pub struct NameRng(u64);
impl NameRng {
    pub fn new(seed: u64) -> Self {
        Self(seed.wrapping_mul(0x9E3779B97F4A7C15) | 1)
    }
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
    pub fn below(&mut self, n: u32) -> u32 {
        (self.next() % n.max(1) as u64) as u32
    }
}

impl Culture {
    pub fn from_pack(id: impl Into<String>, pack: CulturePack) -> Self {
        let order = pack.order.clamp(1, 5);
        let mut table: HashMap<Vec<char>, Vec<(char, u32)>> = HashMap::new();
        let mut min_len = usize::MAX;
        let mut max_len = 0;
        for word in &pack.corpus {
            let chars: Vec<char> = word.chars().collect();
            if chars.len() < 2 {
                continue;
            }
            min_len = min_len.min(chars.len());
            max_len = max_len.max(chars.len());
            let mut ctx: Vec<char> = vec!['^'; order];
            for &c in chars.iter().chain(std::iter::once(&'$')) {
                let c = if c == '$' { '$' } else { c.to_ascii_lowercase() };
                let entry = table.entry(ctx.clone()).or_default();
                match entry.iter_mut().find(|(k, _)| *k == c) {
                    Some(e) => e.1 += 1,
                    None => entry.push((c, 1)),
                }
                ctx.remove(0);
                ctx.push(c);
            }
        }
        if min_len == usize::MAX {
            min_len = 4;
            max_len = 9;
        }
        Self { id: id.into(), pack, order, table, min_len: min_len.max(3), max_len: max_len.max(5) }
    }

    pub fn load_file(path: &Path) -> Result<Culture> {
        let text = std::fs::read_to_string(path).with_context(|| format!("read {}", path.display()))?;
        let pack: CulturePack = serde_json::from_str(&text).with_context(|| format!("parse {}", path.display()))?;
        let id = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "culture".into());
        Ok(Culture::from_pack(id, pack))
    }

    /// A bare root name, capitalised.
    pub fn root(&self, rng: &mut NameRng) -> String {
        for _ in 0..40 {
            let mut ctx: Vec<char> = vec!['^'; self.order];
            let mut out = String::new();
            while let Some(choices) = self.table.get(&ctx) {
                let total: u32 = choices.iter().map(|c| c.1).sum();
                let mut pick = rng.below(total);
                let mut next = '$';
                for (c, n) in choices {
                    if pick < *n {
                        next = *c;
                        break;
                    }
                    pick -= n;
                }
                if next == '$' {
                    // Refuse to stop too early when other choices exist.
                    if out.chars().count() < self.min_len && choices.len() > 1 {
                        let alt: Vec<&(char, u32)> = choices.iter().filter(|c| c.0 != '$').collect();
                        let t: u32 = alt.iter().map(|c| c.1).sum();
                        let mut p = rng.below(t);
                        for c in alt {
                            if p < c.1 {
                                next = c.0;
                                break;
                            }
                            p -= c.1;
                        }
                        if next == '$' {
                            break;
                        }
                    } else {
                        break;
                    }
                }
                out.push(next);
                ctx.remove(0);
                ctx.push(next);
                if out.chars().count() >= self.max_len + 2 {
                    break;
                }
            }
            let n = out.chars().count();
            if n >= self.min_len.min(4) && n <= self.max_len + 2 && !self.pack.corpus.iter().any(|w| w.eq_ignore_ascii_case(&out)) {
                return capitalize(&out);
            }
        }
        // Fallback: a corpus entry.
        let i = rng.below(self.pack.corpus.len().max(1) as u32) as usize;
        self.pack.corpus.get(i).cloned().unwrap_or_else(|| "Nameless".into())
    }

    /// A full name for a feature kind using the pack's templates.
    pub fn name_for(&self, kind: &str, rng: &mut NameRng) -> String {
        let root = self.root(rng);
        self.apply_template(kind, &root, rng)
    }

    pub fn apply_template(&self, kind: &str, root: &str, rng: &mut NameRng) -> String {
        match self.pack.generics.get(kind) {
            Some(t) if !t.is_empty() => {
                let i = rng.below(t.len() as u32) as usize;
                expand(&t[i], root)
            }
            _ => root.to_string(),
        }
    }

    /// Derived names that share a root: "Aldwyn" → "Aldwynmouth", "Aldwyn Vale"…
    pub fn family(&self, root: &str) -> Vec<(String, String)> {
        let mut out = Vec::new();
        for (kind, ts) in &self.pack.generics {
            if let Some(t) = ts.first() {
                out.push((kind.clone(), expand(t, root)));
            }
        }
        out.sort();
        out
    }
}

fn expand(template: &str, root: &str) -> String {
    template.replace("{root}", root)
}

pub fn capitalize(s: &str) -> String {
    let mut c = s.chars();
    match c.next() {
        Some(f) => f.to_uppercase().collect::<String>() + c.as_str(),
        None => String::new(),
    }
}

/// Where the shipped culture packs live.
pub fn builtin_culture_dirs() -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    if let Ok(p) = std::env::var("ISOLINE_ASSETS") {
        out.push(std::path::PathBuf::from(p).join("cultures"));
    }
    if let Ok(exe) = std::env::current_exe() {
        for anc in exe.ancestors().take(4) {
            let p = anc.join("assets").join("cultures");
            if p.is_dir() {
                out.push(p);
            }
        }
    }
    #[cfg(debug_assertions)]
    {
        let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../assets/cultures");
        if src.is_dir() {
            out.push(src);
        }
    }
    if let Some(e) = crate::assets::embedded_assets_dir() {
        out.push(e.join("cultures"));
    }
    let mut seen = std::collections::HashSet::new();
    out.into_iter().filter_map(|p| p.canonicalize().ok()).filter(|p| seen.insert(p.clone())).collect()
}

pub fn load_cultures(dirs: &[std::path::PathBuf]) -> Vec<Culture> {
    let mut out: Vec<Culture> = Vec::new();
    for d in dirs {
        let Ok(rd) = std::fs::read_dir(d) else { continue };
        let mut files: Vec<_> = rd.flatten().map(|e| e.path()).filter(|p| p.extension().map(|e| e == "json").unwrap_or(false)).collect();
        files.sort();
        for f in files {
            match Culture::load_file(&f) {
                Ok(c) => {
                    if !out.iter().any(|o| o.id == c.id) {
                        out.push(c);
                    }
                }
                Err(e) => log::warn!("culture {}: {e:#}", f.display()),
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn generates_plausible_names() {
        let cultures = load_cultures(&builtin_culture_dirs());
        assert!(cultures.len() >= 4, "{} cultures", cultures.len());
        let c = cultures.iter().find(|c| c.id == "northern").unwrap();
        let mut rng = NameRng::new(5);
        let mut seen = std::collections::HashSet::new();
        for _ in 0..50 {
            let r = c.root(&mut rng);
            assert!(r.chars().count() >= 3, "{r}");
            assert!(r.chars().next().unwrap().is_uppercase());
            seen.insert(r);
        }
        assert!(seen.len() > 25, "too little variety: {}", seen.len());
        let river = c.name_for("river", &mut rng);
        assert!(river.contains("River") || river.contains("elv") || river.contains("strom"), "{river}");
        let fam = c.family("Ask");
        assert!(fam.iter().any(|(k, _)| k == "lake"));
    }
}
