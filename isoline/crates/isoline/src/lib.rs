//! Isoline — a field-based fantasy map maker. The desktop binary and the
//! browser build share this library.

pub mod app;
pub mod autoname;
#[cfg(not(target_arch = "wasm32"))]
pub mod bench;
pub mod camera;
pub mod diagnostics;
pub mod document;
pub mod export;
pub mod gpu;
pub mod jobs;
pub mod labels;
pub mod library;
pub mod platform;
pub mod svg;
pub mod themes;
pub mod tools;
pub mod ui;

#[cfg(target_arch = "wasm32")]
mod web_entry {
    use wasm_bindgen::prelude::*;

    /// Browser entry point: called by the page once the module has loaded.
    #[wasm_bindgen(start)]
    pub fn start() {
        crate::diagnostics::install();
        let opts = crate::app::StartupOptions { size: 1024, ..Default::default() };
        if let Err(e) = crate::app::run(opts) {
            crate::diagnostics::fatal("Isoline could not start in this browser.", &format!("{e:#}"));
        }
    }

    /// A named command from the page script, for tests: `export` writes the
    /// map as a PNG download, `fit` frames the whole map.
    #[wasm_bindgen]
    pub fn run_command(name: String) {
        crate::platform::push_command(name);
    }

    /// Files dropped onto the page arrive here from the page script.
    #[wasm_bindgen]
    pub fn drop_file(name: String, bytes: Vec<u8>) {
        crate::platform::push_dropped_file(name, bytes);
    }
}
