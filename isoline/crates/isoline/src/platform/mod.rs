//! What differs between the desktop and the browser: file dialogs, where
//! saved files go, persistent storage for autosaves, and dropped files.
//! Results that arrive later (a picked file, a stored autosave) are sent
//! into the event loop as `UserEvent::Platform`.

use std::cell::RefCell;
use std::path::PathBuf;

/// Why files were requested; tells the app what to do with them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Purpose {
    OpenProject,
    ImportImages,
    ImportTheme,
    /// Dropped onto the page or window: a project, a theme or images.
    Dropped,
}

#[derive(Clone, Debug)]
pub struct PickedFile {
    pub name: String,
    pub bytes: Vec<u8>,
    /// Where it came from, when there is a file system.
    pub path: Option<PathBuf>,
}

impl PickedFile {
    pub fn extension(&self) -> String {
        self.name.rsplit('.').next().map(|e| e.to_ascii_lowercase()).unwrap_or_default()
    }
    pub fn stem(&self) -> String {
        self.name.rsplit_once('.').map(|(s, _)| s.to_string()).unwrap_or_else(|| self.name.clone())
    }
}

#[derive(Debug)]
pub enum PlatformEvent {
    Files { purpose: Purpose, files: Vec<PickedFile> },
    /// A project folder was chosen (desktop only).
    ProjectFolder(PathBuf),
    /// A stored blob was read back; `None` when nothing is stored under the key.
    Stored { key: String, bytes: Option<Vec<u8>> },
}

/// A file-type filter for dialogs: a label and extensions without dots.
pub type Filter<'a> = (&'a str, &'a [&'a str]);

pub const IS_WEB: bool = cfg!(target_arch = "wasm32");

/// Storage key of the browser autosave.
pub const AUTOSAVE_KEY: &str = "autosave";

thread_local! {
    static DROPPED: RefCell<Vec<PickedFile>> = const { RefCell::new(Vec::new()) };
    static COMMANDS: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

/// Queue a named command from the page (used by the browser tests).
pub fn push_command(name: String) {
    COMMANDS.with(|c| c.borrow_mut().push(name));
}

pub fn take_commands() -> Vec<String> {
    COMMANDS.with(|c| std::mem::take(&mut *c.borrow_mut()))
}

/// Queue a file dropped onto the page; the app collects it next frame.
pub fn push_dropped_file(name: String, bytes: Vec<u8>) {
    DROPPED.with(|d| d.borrow_mut().push(PickedFile { name, bytes, path: None }));
}

pub fn take_dropped_files() -> Vec<PickedFile> {
    DROPPED.with(|d| std::mem::take(&mut *d.borrow_mut()))
}

#[cfg(not(target_arch = "wasm32"))]
mod native;
#[cfg(not(target_arch = "wasm32"))]
pub use native::*;

#[cfg(target_arch = "wasm32")]
mod web;
#[cfg(target_arch = "wasm32")]
pub use web::*;
