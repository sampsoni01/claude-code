//! wgpu device ownership and the GPU-side field pipeline.

pub mod brush;
pub mod field;
pub mod map_render;
pub mod profiler;

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
    pub fn new(instance: wgpu::Instance, surface: Option<&wgpu::Surface<'_>>) -> Result<Self> {
        let adapter = pollster::block_on(instance.request_adapter(&wgpu::RequestAdapterOptions {
            power_preference: wgpu::PowerPreference::HighPerformance,
            compatible_surface: surface,
            force_fallback_adapter: false,
        }))
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
        let (device, queue) = pollster::block_on(adapter.request_device(&wgpu::DeviceDescriptor {
            label: Some("isoline device"),
            required_features: wanted,
            required_limits: limits.clone(),
            experimental_features: wgpu::ExperimentalFeatures::disabled(),
            memory_hints: wgpu::MemoryHints::Performance,
            trace: wgpu::Trace::Off,
        }))
        .context("request_device")?;
        device.on_uncaptured_error(Arc::new(|e: wgpu::Error| {
            log::error!("wgpu error: {e}");
        }));
        Ok(Self { instance, adapter, device, queue, info, limits, features: wanted })
    }

    pub fn new_instance() -> wgpu::Instance {
        let mut desc = wgpu::InstanceDescriptor::new_without_display_handle_from_env();
        if wgpu::Backends::from_env().is_none() {
            desc.backends = wgpu::Backends::PRIMARY;
        }
        wgpu::Instance::new(desc)
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
