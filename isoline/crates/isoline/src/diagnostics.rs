//! Crash and startup diagnostics: a log file next to the program, a crash
//! log with the panic message, and an error dialog so a failed launch
//! explains itself instead of closing silently.

#[cfg(not(target_arch = "wasm32"))]
mod native {
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

pub const LOG_FILE: &str = "isoline.log";
pub const CRASH_FILE: &str = "isoline-crash.log";

/// Show dialogs for fatal errors (off for headless command-line runs).
static DIALOGS: AtomicBool = AtomicBool::new(false);
static LOG_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

pub fn set_dialogs(on: bool) {
    DIALOGS.store(on, Ordering::Relaxed);
}

/// Where log files go: next to the executable when that folder is
/// writable, otherwise the per-user data folder.
pub fn log_dir() -> Option<PathBuf> {
    if let Some(d) = LOG_DIR.lock().ok().and_then(|g| g.clone()) {
        return Some(d);
    }
    let mut candidates = Vec::new();
    if let Some(exe_dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(Path::to_path_buf)) {
        candidates.push(exe_dir);
    }
    if let Some(d) = dirs::data_local_dir() {
        candidates.push(d.join("isoline"));
    }
    candidates.push(std::env::temp_dir());
    for c in candidates {
        if std::fs::create_dir_all(&c).is_err() {
            continue;
        }
        let probe = c.join(".isoline-write-test");
        if File::create(&probe).is_ok() {
            let _ = std::fs::remove_file(&probe);
            if let Ok(mut g) = LOG_DIR.lock() {
                *g = Some(c.clone());
            }
            return Some(c);
        }
    }
    None
}

fn header() -> String {
    let exe = std::env::current_exe().map(|p| p.display().to_string()).unwrap_or_default();
    let args: Vec<String> = std::env::args().skip(1).collect();
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    format!(
        "Isoline {} ({} {})\nexecutable: {exe}\narguments: {args:?}\nunix time: {now}\n",
        env!("CARGO_PKG_VERSION"),
        std::env::consts::OS,
        std::env::consts::ARCH
    )
}

struct Tee {
    inner: env_logger::Logger,
    file: Mutex<Option<File>>,
}

impl log::Log for Tee {
    fn enabled(&self, m: &log::Metadata) -> bool {
        self.inner.enabled(m)
    }

    fn log(&self, r: &log::Record) {
        if !self.inner.matches(r) {
            return;
        }
        self.inner.log(r);
        if let Ok(mut g) = self.file.lock() {
            if let Some(f) = g.as_mut() {
                let _ = writeln!(f, "[{} {}] {}", r.level(), r.target(), r.args());
            }
        }
    }

    fn flush(&self) {
        if let Ok(mut g) = self.file.lock() {
            if let Some(f) = g.as_mut() {
                let _ = f.flush();
            }
        }
    }
}

/// Install the logger (stderr plus `isoline.log`) and the panic hook.
pub fn install() {
    let inner = env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info,wgpu_core=warn,wgpu_hal=warn,naga=warn")).build();
    let filter = inner.filter();
    let file = log_dir().and_then(|d| {
        let mut f = File::create(d.join(LOG_FILE)).ok()?;
        let _ = writeln!(f, "{}", header());
        Some(f)
    });
    if log::set_boxed_logger(Box::new(Tee { inner, file: Mutex::new(file) })).is_ok() {
        log::set_max_level(filter);
    }

    std::panic::set_hook(Box::new(|info| {
        let msg = if let Some(s) = info.payload().downcast_ref::<&str>() {
            s.to_string()
        } else if let Some(s) = info.payload().downcast_ref::<String>() {
            s.clone()
        } else {
            "unknown panic".to_string()
        };
        let loc = info.location().map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column())).unwrap_or_else(|| "unknown location".into());
        let thread = std::thread::current();
        let thread_name = thread.name().unwrap_or("?").to_string();
        let bt = std::backtrace::Backtrace::force_capture();
        let text = format!("{}\ncrash: {msg}\nat: {loc}\nthread: {thread_name}\n\nbacktrace:\n{bt}\n", header());
        eprintln!("{text}");
        log::error!("panic: {msg} at {loc} (thread {thread_name})");
        log::logger().flush();
        let path = write_crash(&text);
        if thread_name == "main" {
            fatal_dialog("Isoline crashed", &format!("{msg}\n\nat {loc}"), path.as_deref());
        }
    }));
    log::info!("{}", header().trim_end());
}

fn write_crash(text: &str) -> Option<PathBuf> {
    let dir = log_dir()?;
    let path = dir.join(CRASH_FILE);
    std::fs::write(&path, text).ok()?;
    Some(path)
}

/// Report a fatal startup error: log it, write the crash file, and show a
/// dialog when running interactively.
pub fn fatal(context: &str, err: &str) {
    let text = format!("{}\nfatal: {context}\n{err}\n", header());
    eprintln!("{context}: {err}");
    log::error!("{context}: {err}");
    log::logger().flush();
    let path = write_crash(&text);
    fatal_dialog("Isoline could not start", &format!("{context}\n\n{err}"), path.as_deref());
}

fn fatal_dialog(title: &str, body: &str, crash_path: Option<&Path>) {
    if !DIALOGS.load(Ordering::Relaxed) {
        return;
    }
    let mut desc = body.to_string();
    if let Some(p) = crash_path {
        desc.push_str(&format!("\n\nDetails were saved to:\n{}\n\nPlease send that file (and {} next to it) when reporting the problem.", p.display(), LOG_FILE));
    }
    rfd::MessageDialog::new().set_level(rfd::MessageLevel::Error).set_title(title).set_description(desc).set_buttons(rfd::MessageButtons::Ok).show();
}
}

#[cfg(not(target_arch = "wasm32"))]
pub use native::*;

#[cfg(target_arch = "wasm32")]
mod web {
    //! Browser: log to the console, show a panic in the page.
    use std::sync::atomic::{AtomicBool, Ordering};

    static INSTALLED: AtomicBool = AtomicBool::new(false);

    struct ConsoleLogger;

    impl log::Log for ConsoleLogger {
        fn enabled(&self, m: &log::Metadata) -> bool {
            let t = m.target();
            if t.starts_with("wgpu") || t.starts_with("naga") {
                m.level() <= log::Level::Warn
            } else {
                m.level() <= log::Level::Info
            }
        }
        fn log(&self, r: &log::Record) {
            if !self.enabled(r.metadata()) {
                return;
            }
            let line = format!("[{} {}] {}", r.level(), r.target(), r.args());
            let v = wasm_bindgen::JsValue::from_str(&line);
            match r.level() {
                log::Level::Error => web_sys::console::error_1(&v),
                log::Level::Warn => web_sys::console::warn_1(&v),
                _ => web_sys::console::log_1(&v),
            }
        }
        fn flush(&self) {}
    }

    pub fn set_dialogs(_on: bool) {}

    fn show_overlay(title: &str, body: &str) {
        let Some(doc) = web_sys::window().and_then(|w| w.document()) else { return };
        let el = match doc.get_element_by_id("isoline-crash") {
            Some(e) => e,
            None => {
                let Ok(e) = doc.create_element("pre") else { return };
                e.set_id("isoline-crash");
                let _ = e.set_attribute(
                    "style",
                    "position:fixed;left:0;top:0;right:0;max-height:60vh;overflow:auto;margin:0;padding:16px;background:#2a1414;color:#ffd9d9;font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap;z-index:1000",
                );
                if let Some(b) = doc.body() {
                    let _ = b.append_child(&e);
                }
                e
            }
        };
        el.set_text_content(Some(&format!("{title}\n\n{body}\n\nReload the page to try again. Please report this message.")));
    }

    pub fn install() {
        if INSTALLED.swap(true, Ordering::Relaxed) {
            return;
        }
        let _ = log::set_logger(&ConsoleLogger);
        log::set_max_level(log::LevelFilter::Info);
        std::panic::set_hook(Box::new(|info| {
            let msg = if let Some(s) = info.payload().downcast_ref::<&str>() {
                s.to_string()
            } else if let Some(s) = info.payload().downcast_ref::<String>() {
                s.clone()
            } else {
                "unknown panic".to_string()
            };
            let loc = info.location().map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column())).unwrap_or_else(|| "unknown location".into());
            let text = format!("crash: {msg}\nat: {loc}");
            web_sys::console::error_1(&wasm_bindgen::JsValue::from_str(&text));
            show_overlay("Isoline crashed", &text);
        }));
        log::info!("Isoline {} (browser)", env!("CARGO_PKG_VERSION"));
    }

    pub fn fatal(context: &str, err: &str) {
        let text = format!("{context}\n{err}");
        web_sys::console::error_1(&wasm_bindgen::JsValue::from_str(&text));
        show_overlay("Isoline could not start", &text);
    }
}

#[cfg(target_arch = "wasm32")]
pub use web::*;
