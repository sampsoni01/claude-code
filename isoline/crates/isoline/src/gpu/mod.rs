//! wgpu device ownership and the GPU-side field pipeline.

pub mod brush;
pub mod field;
pub mod map_render;
pub mod profiler;
pub mod sprites;

use anyhow::{anyhow, Context, Result};
use std::sync::Arc;

pub struct Gpu {
    /// Kept alive for surface re-creation (multi-window support later).
    #[allow(dead_code)]
    pub instance: wgpu::Instance,
    pub adapter: wgpu::Adapter,
    pub device: wgpu::Device,
    pub queue: wgpu::Queue,
    pub info: wgpu::AdapterInfo,
    pub limits: wgpu::Limits,
    pub features: wgpu::Features,
}

impl Gpu {
    /// Create an instance/adapter/device. `surface` restricts adapter choice
    /// to one that can present to it; headless callers pass `None`.
    #[cfg(not(target_arch = "wasm32"))]
    pub fn new(instance: wgpu::Instance, surface: Option<&wgpu::Surface<'_>>) -> Result<Self> {
        pollster::block_on(Self::new_async(instance, surface))
    }

    pub async fn new_async(instance: wgpu::Instance, surface: Option<&wgpu::Surface<'_>>) -> Result<Self> {
        let adapter = instance
            .request_adapter(&wgpu::RequestAdapterOptions {
                power_preference: wgpu::PowerPreference::HighPerformance,
                compatible_surface: surface,
                force_fallback_adapter: false,
            })
            .await
            .map_err(|e| anyhow!("no suitable GPU adapter: {e}"))?;
        let info = adapter.get_info();
        log::info!(
            "adapter: {} ({:?}, {:?}) driver {} {}",
            info.name,
            info.backend,
            info.device_type,
            info.driver,
            info.driver_info
        );

        let supported = adapter.features();
        let mut wanted = wgpu::Features::empty();
        for f in [wgpu::Features::TIMESTAMP_QUERY, wgpu::Features::FLOAT32_FILTERABLE] {
            if supported.contains(f) {
                wanted |= f;
            }
        }
        // Ask for everything the adapter offers so 8192² and larger fields
        // and large storage buffers are usable; we never rely on more than
        // the adapter reports.
        let limits = adapter.limits();
        let (device, queue) = adapter
            .request_device(&wgpu::DeviceDescriptor {
                label: Some("isoline device"),
                required_features: wanted,
                required_limits: limits.clone(),
                experimental_features: wgpu::ExperimentalFeatures::disabled(),
                memory_hints: wgpu::MemoryHints::Performance,
                trace: wgpu::Trace::Off,
            })
            .await
            .context("request_device")?;
        device.on_uncaptured_error(Arc::new(|e: wgpu::Error| {
            log::error!("wgpu error: {e}");
        }));
        device.set_device_lost_callback(|reason, msg| {
            log::error!("graphics device lost ({reason:?}): {msg}");
            if !matches!(reason, wgpu::DeviceLostReason::Destroyed) {
                crate::diagnostics::fatal("The graphics device was lost.", &format!("{reason:?}: {msg}"));
            }
        });
        Ok(Self { instance, adapter, device, queue, info, limits, features: wanted })
    }

    pub fn new_instance() -> wgpu::Instance {
        Self::new_instance_with(wgpu::Backends::PRIMARY)
    }

    fn new_instance_with(backends: wgpu::Backends) -> wgpu::Instance {
        let mut desc = wgpu::InstanceDescriptor::new_without_display_handle_from_env();
        if wgpu::Backends::from_env().is_none() {
            desc.backends = backends;
        }
        wgpu::Instance::new(desc)
    }

    /// Create a surface for `window` and a device that can present to it.
    /// The main backends (Vulkan, DirectX 12, Metal) are tried first; if
    /// none of them offers a usable adapter, OpenGL is tried as a fallback.
    pub async fn new_for_window(window: Arc<winit::window::Window>) -> Result<(wgpu::Surface<'static>, Self)> {
        let mut last_err = None;
        for (name, backends) in [("primary", wgpu::Backends::PRIMARY), ("OpenGL", wgpu::Backends::GL)] {
            let instance = Self::new_instance_with(backends);
            let surface = match instance.create_surface(window.clone()) {
                Ok(s) => s,
                Err(e) => {
                    log::warn!("{name} backends: cannot create a surface: {e}");
                    last_err = Some(anyhow!("create surface ({name}): {e}"));
                    continue;
                }
            };
            match Self::new_async(instance, Some(&surface)).await {
                Ok(gpu) => return Ok((surface, gpu)),
                Err(e) => {
                    log::warn!("{name} backends: {e:#}");
                    last_err = Some(e);
                }
            }
            if wgpu::Backends::from_env().is_some() {
                break;
            }
        }
        Err(last_err.unwrap_or_else(|| anyhow!("no graphics backend available")))
    }

    /// Report a validation error from a pipeline's error scope: the desktop
    /// waits for it and stops, the browser logs it when it arrives.
    pub fn check_scope(scope: wgpu::ErrorScopeGuard, what: &'static str) {
        #[cfg(not(target_arch = "wasm32"))]
        if let Some(e) = pollster::block_on(scope.pop()) {
            panic!("{what} failed validation: {e}");
        }
        #[cfg(target_arch = "wasm32")]
        {
            let fut = scope.pop();
            wasm_bindgen_futures::spawn_local(async move {
                if let Some(e) = fut.await as Option<wgpu::Error> {
                    log::error!("{what} failed validation: {e}");
                    crate::diagnostics::fatal(&format!("{what} failed validation"), &e.to_string());
                }
            });
        }
    }

    pub fn max_field_dim(&self) -> u32 {
        self.limits.max_texture_dimension_2d
    }

    pub fn has_timestamps(&self) -> bool {
        self.features.contains(wgpu::Features::TIMESTAMP_QUERY)
    }

    /// Best available estimate of bytes allocated on the device.
    pub fn allocated_bytes(&self) -> Option<u64> {
        self.device.generate_allocator_report().map(|r| r.total_allocated_bytes)
    }
}
