//! Browser: file pickers are asynchronous, saving means downloading, and
//! the autosave lives in IndexedDB.

use super::{Filter, PickedFile, PlatformEvent, Purpose};
use crate::app::UserEvent;
use anyhow::Result;
use std::path::{Path, PathBuf};
use wasm_bindgen::prelude::*;
use wasm_bindgen::JsCast;
use wasm_bindgen_futures::JsFuture;
use winit::event_loop::EventLoopProxy;

#[wasm_bindgen(inline_js = r#"
export function isoline_pick_files(accept, multiple) {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.multiple = !!multiple;
        input.style.display = 'none';
        document.body.appendChild(input);
        let done = false;
        const finish = async () => {
            if (done) return;
            done = true;
            const out = [];
            for (const f of input.files || []) {
                out.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
            }
            input.remove();
            resolve(out);
        };
        input.addEventListener('change', finish);
        // No 'change' fires on cancel; a focus return with no files means cancelled.
        window.addEventListener('focus', () => setTimeout(finish, 800), { once: true });
        input.click();
    });
}
export function isoline_download(name, mime, bytes) {
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 2000);
}
function isoline_db() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('isoline', 1);
        req.onupgradeneeded = () => { req.result.createObjectStore('blobs'); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
export async function isoline_store_put(key, bytes) {
    const db = await isoline_db();
    const copy = new Uint8Array(bytes);
    await new Promise((resolve, reject) => {
        const tx = db.transaction('blobs', 'readwrite');
        tx.objectStore('blobs').put(copy, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}
export async function isoline_store_get(key) {
    const db = await isoline_db();
    const value = await new Promise((resolve, reject) => {
        const tx = db.transaction('blobs', 'readonly');
        const req = tx.objectStore('blobs').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    db.close();
    return value === undefined ? null : value;
}
export async function isoline_store_delete(key) {
    const db = await isoline_db();
    await new Promise((resolve, reject) => {
        const tx = db.transaction('blobs', 'readwrite');
        tx.objectStore('blobs').delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}
"#)]
extern "C" {
    fn isoline_pick_files(accept: &str, multiple: bool) -> js_sys::Promise;
    fn isoline_download(name: &str, mime: &str, bytes: &[u8]);
    fn isoline_store_put(key: &str, bytes: &[u8]) -> js_sys::Promise;
    fn isoline_store_get(key: &str) -> js_sys::Promise;
    fn isoline_store_delete(key: &str) -> js_sys::Promise;
}

/// Ask for one or more files; they arrive later as `PlatformEvent::Files`.
/// Uses a hidden file input clicked while the user's click still counts
/// as activation, so the browser's own picker opens.
pub fn pick_files(purpose: Purpose, _title: &str, filters: &[Filter<'_>], multiple: bool, proxy: &EventLoopProxy<UserEvent>) {
    let accept: Vec<String> = filters.iter().flat_map(|(_, exts)| exts.iter().map(|e| format!(".{e}"))).collect();
    let promise = isoline_pick_files(&accept.join(","), multiple);
    let proxy = proxy.clone();
    wasm_bindgen_futures::spawn_local(async move {
        let Ok(list) = JsFuture::from(promise).await else { return };
        let mut files = Vec::new();
        if let Some(arr) = list.dyn_ref::<js_sys::Array>() {
            for item in arr.iter() {
                let name = js_sys::Reflect::get(&item, &"name".into()).ok().and_then(|v| v.as_string()).unwrap_or_else(|| "file".into());
                let bytes = js_sys::Reflect::get(&item, &"bytes".into()).ok().map(|v| js_sys::Uint8Array::new(&v).to_vec()).unwrap_or_default();
                files.push(PickedFile { name, bytes, path: None });
            }
        }
        if !files.is_empty() {
            let _ = proxy.send_event(UserEvent::Platform(PlatformEvent::Files { purpose, files }));
        }
    });
}

/// Ask for a project to open: a `.isoline.zip` archive in the browser.
pub fn pick_project(proxy: &EventLoopProxy<UserEvent>) {
    pick_files(Purpose::OpenProject, "Open map", &[("Isoline project", &["zip"])], false, proxy);
}

/// Save bytes: the browser downloads them under the suggested name.
pub fn save_file(_title: &str, suggested_name: &str, _filters: &[Filter<'_>], mime: &str, bytes: &[u8]) -> Result<Option<String>> {
    isoline_download(suggested_name, mime, bytes);
    Ok(Some(suggested_name.to_string()))
}

/// Exports are assembled in memory and downloaded when done, so the
/// "path" is just the file name.
pub fn choose_export_path(_title: &str, suggested_name: &str, _filters: &[Filter<'_>]) -> Option<PathBuf> {
    Some(PathBuf::from(suggested_name))
}

/// Hand finished bytes to the user as a download.
pub fn deliver_file(name: &str, mime: &str, bytes: Vec<u8>) {
    isoline_download(name, mime, &bytes);
}

pub fn store_put(key: &str, bytes: &[u8]) {
    let promise = isoline_store_put(key, bytes);
    let key = key.to_string();
    wasm_bindgen_futures::spawn_local(async move {
        if let Err(e) = JsFuture::from(promise).await {
            log::warn!("store {key}: {e:?}");
        }
    });
}

pub fn store_get(key: &str, proxy: &EventLoopProxy<UserEvent>) {
    let promise = isoline_store_get(key);
    let key = key.to_string();
    let proxy = proxy.clone();
    wasm_bindgen_futures::spawn_local(async move {
        let bytes = match JsFuture::from(promise).await {
            Ok(v) if !v.is_null() && !v.is_undefined() => Some(js_sys::Uint8Array::new(&v).to_vec()),
            Ok(_) => None,
            Err(e) => {
                log::warn!("store {key}: {e:?}");
                None
            }
        };
        let _ = proxy.send_event(UserEvent::Platform(PlatformEvent::Stored { key, bytes }));
    });
}

pub fn store_delete(key: &str) {
    let promise = isoline_store_delete(key);
    wasm_bindgen_futures::spawn_local(async move {
        let _ = JsFuture::from(promise).await;
    });
}

/// A short description of a path for status messages.
pub fn describe_path(p: &Path) -> String {
    p.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Local storage for small per-user settings (favourites, recents).
pub fn local_get(key: &str) -> Option<String> {
    web_sys::window()?.local_storage().ok()??.get_item(key).ok()?
}

pub fn local_set(key: &str, value: &str) {
    if let Some(s) = web_sys::window().and_then(|w| w.local_storage().ok().flatten()) {
        let _ = s.set_item(key, value);
    }
}

/// Hand finished bytes to the user under the name an export was given.
pub fn write_output(path: &Path, mime: &str, bytes: Vec<u8>) -> Result<()> {
    deliver_file(&describe_path(path), mime, bytes);
    Ok(())
}

/// Mark the canvas with a data attribute the page script can read.
pub fn set_canvas_flag(name: &str, value: &str) {
    if let Some(c) = web_sys::window().and_then(|w| w.document()).and_then(|d| d.get_element_by_id("isoline")) {
        let _ = c.set_attribute(name, value);
    }
}
