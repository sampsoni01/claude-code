//! Desktop: native dialogs, real files, a per-user store folder.

use super::{Filter, PickedFile, PlatformEvent, Purpose};
use crate::app::UserEvent;
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use winit::event_loop::EventLoopProxy;

fn dialog(title: &str, filters: &[Filter<'_>]) -> rfd::FileDialog {
    let mut d = rfd::FileDialog::new().set_title(title);
    for (name, exts) in filters {
        d = d.add_filter(*name, exts);
    }
    d
}

fn read_picked(paths: Vec<PathBuf>) -> Vec<PickedFile> {
    let mut out = Vec::new();
    for p in paths {
        match std::fs::read(&p) {
            Ok(bytes) => out.push(PickedFile { name: p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into()), bytes, path: Some(p) }),
            Err(e) => log::warn!("read {}: {e}", p.display()),
        }
    }
    out
}

/// Ask for one or more files; they arrive as `PlatformEvent::Files`.
pub fn pick_files(purpose: Purpose, title: &str, filters: &[Filter<'_>], multiple: bool, proxy: &EventLoopProxy<UserEvent>) {
    let d = dialog(title, filters);
    let paths = if multiple { d.pick_files().unwrap_or_default() } else { d.pick_file().into_iter().collect() };
    if paths.is_empty() {
        return;
    }
    let _ = proxy.send_event(UserEvent::Platform(PlatformEvent::Files { purpose, files: read_picked(paths) }));
}

/// Ask for a project to open: a project folder on the desktop.
pub fn pick_project(proxy: &EventLoopProxy<UserEvent>) {
    if let Some(p) = rfd::FileDialog::new().set_title("Open map (choose the .isoline folder)").pick_folder() {
        let _ = proxy.send_event(UserEvent::Platform(PlatformEvent::ProjectFolder(p)));
    }
}

/// Save bytes under a name the user confirms. Returns where they went, or
/// `None` when the dialog was cancelled.
pub fn save_file(title: &str, suggested_name: &str, filters: &[Filter<'_>], _mime: &str, bytes: &[u8]) -> Result<Option<String>> {
    let Some(path) = dialog(title, filters).set_file_name(suggested_name).save_file() else { return Ok(None) };
    std::fs::write(&path, bytes).with_context(|| format!("write {}", path.display()))?;
    Ok(Some(path.display().to_string()))
}

/// Where an export that streams to disk should go.
pub fn choose_export_path(title: &str, suggested_name: &str, filters: &[Filter<'_>]) -> Option<PathBuf> {
    dialog(title, filters).set_file_name(suggested_name).save_file()
}

/// Hand finished bytes to the user. On the desktop exports are written
/// where `choose_export_path` said, so there is nothing left to do.
pub fn deliver_file(_name: &str, _mime: &str, _bytes: Vec<u8>) {}

fn store_dir() -> Option<PathBuf> {
    dirs::data_local_dir().map(|d| d.join("isoline").join("store"))
}

fn store_path(key: &str) -> Option<PathBuf> {
    store_dir().map(|d| d.join(format!("{key}.bin")))
}

pub fn store_put(key: &str, bytes: &[u8]) {
    if let Some(p) = store_path(key) {
        if let Some(parent) = p.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Err(e) = std::fs::write(&p, bytes) {
            log::warn!("store {key}: {e}");
        }
    }
}

pub fn store_get(key: &str, proxy: &EventLoopProxy<UserEvent>) {
    let bytes = store_path(key).and_then(|p| std::fs::read(p).ok());
    let _ = proxy.send_event(UserEvent::Platform(PlatformEvent::Stored { key: key.to_string(), bytes }));
}

pub fn store_delete(key: &str) {
    if let Some(p) = store_path(key) {
        let _ = std::fs::remove_file(p);
    }
}

/// A short description of a path for status messages.
pub fn describe_path(p: &Path) -> String {
    p.display().to_string()
}

/// Write finished bytes to the path an export was given.
pub fn write_output(path: &Path, _mime: &str, bytes: Vec<u8>) -> Result<()> {
    std::fs::write(path, bytes).with_context(|| format!("write {}", path.display()))
}

/// No page to mark on the desktop.
pub fn set_canvas_flag(_name: &str, _value: &str) {}
