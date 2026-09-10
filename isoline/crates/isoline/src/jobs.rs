//! Cancellable background jobs with progress. Each job owns a thread; heavy
//! inner loops use rayon so a single job can saturate every core.

use crossbeam_channel::{bounded, Receiver};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Instant;

static RUNNING: AtomicUsize = AtomicUsize::new(0);

pub fn running_jobs() -> usize {
    RUNNING.load(Ordering::Relaxed)
}

pub struct Job<T> {
    pub name: String,
    pub progress: Arc<AtomicU32>,
    /// Cooperative cancellation flag; long passes (erosion, flow) poll it.
    #[allow(dead_code)]
    pub cancel: Arc<AtomicBool>,
    #[allow(dead_code)]
    pub started: Instant,
    rx: Receiver<T>,
}

impl<T: Send + 'static> Job<T> {
    pub fn spawn(name: impl Into<String>, f: impl FnOnce(&AtomicU32, &AtomicBool) -> T + Send + 'static) -> Self {
        let name = name.into();
        let progress = Arc::new(AtomicU32::new(0));
        let cancel = Arc::new(AtomicBool::new(false));
        let (tx, rx) = bounded(1);
        let (p, c) = (progress.clone(), cancel.clone());
        let tname = name.clone();
        RUNNING.fetch_add(1, Ordering::Relaxed);
        std::thread::Builder::new()
            .name(format!("job:{tname}"))
            .spawn(move || {
                let out = f(&p, &c);
                RUNNING.fetch_sub(1, Ordering::Relaxed);
                let _ = tx.send(out);
            })
            .expect("spawn job thread");
        Self { name, progress, cancel, started: Instant::now(), rx }
    }

    pub fn try_take(&self) -> Option<T> {
        self.rx.try_recv().ok()
    }

    /// 0..1
    pub fn progress01(&self) -> f32 {
        self.progress.load(Ordering::Relaxed) as f32 / 1000.0
    }

    #[allow(dead_code)]
    pub fn cancel(&self) {
        self.cancel.store(true, Ordering::Relaxed);
    }
}
