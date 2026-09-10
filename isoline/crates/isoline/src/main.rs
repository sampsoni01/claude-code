//! Isoline — a field-based fantasy map maker.

mod app;
mod bench;
mod camera;
mod document;
mod gpu;
mod jobs;
mod tools;
mod ui;

use std::path::PathBuf;

fn usage() {
    eprintln!("isoline [--open <project-dir>] [--size N] [--bench [N]]");
    eprintln!("  --open   open a project directory on launch");
    eprintln!("  --size   field resolution for the initial map (default 2048)");
    eprintln!("  --bench  run the headless GPU benchmark at N×N (default 2048) and exit");
    eprintln!("  --demo   paint a scripted stroke sequence after the map loads (for testing)");
    eprintln!("  --theme  ink | illuminated | modern");
    eprintln!("  --screenshot <file.png>  save a frame once the map is ready, then exit");
}

fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info,wgpu_core=warn,wgpu_hal=warn,naga=warn"))
        .init();

    let mut args = std::env::args().skip(1);
    let mut opts = app::StartupOptions::default();
    let mut bench: Option<u32> = None;
    while let Some(a) = args.next() {
        match a.as_str() {
            "--open" => opts.open = args.next().map(PathBuf::from),
            "--size" => opts.size = args.next().and_then(|s| s.parse().ok()).unwrap_or(2048),
            "--demo" => opts.demo = true,
            "--theme" => opts.theme = args.next(),
            "--screenshot" => opts.screenshot = args.next().map(PathBuf::from),
            "--bench" => {
                bench = Some(args.next().and_then(|s| s.parse().ok()).unwrap_or(2048));
            }
            "-h" | "--help" => {
                usage();
                return;
            }
            other => {
                if std::path::Path::new(other).join("manifest.json").exists() {
                    opts.open = Some(PathBuf::from(other));
                } else {
                    eprintln!("unknown argument {other}");
                    usage();
                    std::process::exit(2);
                }
            }
        }
    }

    if let Some(size) = bench {
        if let Err(e) = bench::run(size) {
            eprintln!("bench failed: {e:#}");
            std::process::exit(1);
        }
        return;
    }

    if let Err(e) = app::run(opts) {
        eprintln!("fatal: {e:#}");
        std::process::exit(1);
    }
}
