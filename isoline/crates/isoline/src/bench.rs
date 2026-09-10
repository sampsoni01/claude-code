//! Headless benchmark: exercises the field pipeline without a window and
//! validates GPU results against the CPU reference brush.

use crate::gpu::brush::BrushPass;
use crate::gpu::field::GpuField;
use crate::gpu::profiler::GpuProfiler;
use crate::document::{Document, FieldKind};
use crate::gpu::Gpu;
use anyhow::{bail, Result};
use isoline_core::brush::{apply_dabs, Dab, Falloff};
use isoline_core::stats::FieldStats;
use isoline_core::terrain::{generate, TerrainParams};
use isoline_core::tiles::PixelRect;
use std::sync::atomic::{AtomicBool, AtomicU32};
use std::time::Instant;

fn ms(t: Instant) -> f32 {
    t.elapsed().as_secs_f32() * 1000.0
}

pub fn run(size: u32) -> Result<()> {
    let instance = Gpu::new_instance();
    let gpu = Gpu::new(instance, None)?;
    println!("Isoline headless bench");
    println!("  adapter: {} ({:?}, {:?})", gpu.info.name, gpu.info.backend, gpu.info.device_type);
    if size > gpu.max_field_dim() {
        bail!("field size {size} exceeds max texture dimension {}", gpu.max_field_dim());
    }
    println!("  field:   {size} × {size}  ({:.0} MiB per field)", (size as f64 * size as f64 * 4.0) / 1048576.0);
    println!("  threads: {} rayon workers", rayon::current_num_threads());

    let t = Instant::now();
    let params = TerrainParams::default();
    let terrain = generate(size, size, &params, &AtomicU32::new(0), &AtomicBool::new(false));
    println!("terrain generation (CPU, all cores):   {:8.1} ms", ms(t));

    let t = Instant::now();
    let mut stats = FieldStats::new(&terrain, 0.0);
    println!("full stats scan (CPU):                 {:8.1} ms  (land {:.1}%)", ms(t), stats.land_fraction * 100.0);

    let original = terrain.clone();
    {
        let params = isoline_core::derived::DerivedParams::default();
        let t = Instant::now();
        let d = isoline_core::derived::compute(&terrain, 0.0, &params, None, &AtomicBool::new(false), &AtomicU32::new(0));
        let tm = &d.timings;
        let w = &tm.water;
        println!(
            "water (sim {}×{}): {:8.1} ms = downsample {:.0} + moisture {:.0} + fill {:.0} + flow {:.0} + lakes {:.0} + rivers {:.0} + vectorise {:.0}   ({} rivers, {} lakes)",
            w.sim_width, w.sim_height, w.total_ms, w.downsample_ms, w.moisture_ms, w.fill_ms, w.flow_ms, w.lakes_ms, w.rivers_ms, w.vector_ms,
            d.water.rivers.len(), d.water.lakes.len()
        );
        println!(
            "derived chain total: {:8.1} ms  (+ water raster {:.0} + temperature {:.0} + biome {:.0}); wall {:.0} ms",
            tm.total_ms, tm.water_raster_ms, tm.temperature_ms, tm.biome_ms, ms(t)
        );
        println!(
            "water memory: sim intermediates {:.1} MiB peak; derived result kept {:.1} MiB CPU; derived textures {:.1} MiB GPU (water+biome at project res, moisture+temp at sim res)",
            w.sim_bytes as f64 / 1048576.0,
            d.cpu_bytes() as f64 / 1048576.0,
            (2.0 * (size as f64 * size as f64 * 4.0) + 2.0 * (w.sim_width as f64 * w.sim_height as f64 * 4.0) * 2.0) / 1048576.0
        );
        // Baked path: geometry reused, hydrology skipped.
        let baked = isoline_core::derived::BakedWater {
            rivers: d.water.rivers.clone(),
            lakes: d.water.lakes.clone(),
            moisture: d.water.moisture.clone().unwrap().resample(size, size),
        };
        let t = Instant::now();
        let d2 = isoline_core::derived::compute(&terrain, 0.0, &params, Some(&baked), &AtomicBool::new(false), &AtomicU32::new(0));
        println!("derived chain with baked water: {:8.1} ms (raster {:.0} + temperature {:.0} + biome {:.0})", ms(t), d2.timings.water_raster_ms, d2.timings.temperature_ms, d2.timings.biome_ms);
    }
    let mut doc = Document::new("bench", terrain, 0.0, 100.0);

    let t = Instant::now();
    let mut field = GpuField::new(&gpu.device, size, size);
    field.upload_all(&gpu.queue, &doc.elevation);
    gpu.queue.submit([]);
    let _ = gpu.device.poll(wgpu::PollType::wait_indefinitely());
    println!("upload to GPU:                         {:8.1} ms", ms(t));

    let mut brush = BrushPass::new(&gpu.device);
    brush.bind(&gpu.device, "elevation", &field);
    let mut profiler = GpuProfiler::new(&gpu.device, &gpu.queue, gpu.has_timestamps());
    let mut reference = doc.elevation.clone();

    // A diagonal stroke of raise dabs, then a smooth stroke over it.
    let frames = 40;
    let per_frame = 20;
    let radius = (size as f32 / 32.0).max(8.0);
    let make_stroke = |mode: u32, strength: f32| -> Vec<Vec<Dab>> {
        (0..frames)
            .map(|f| {
                (0..per_frame)
                    .map(|i| {
                        let k = (f * per_frame + i) as f32 / (frames * per_frame) as f32;
                        let x = size as f32 * (0.15 + 0.7 * k);
                        let y = size as f32 * (0.2 + 0.6 * k) + (k * 40.0).sin() * radius;
                        Dab { pos: [x, y], radius, strength, hardness: 0.3, target: 0.0, mode, falloff: Falloff::Smooth as u32 }
                    })
                    .collect()
            })
            .collect()
    };

    for (name, batches) in [("raise", make_stroke(0, 25.0)), ("smooth", make_stroke(5, 0.6))] {
        let mut frame_ms = Vec::new();
        let mut readback_ms = Vec::new();
        let mut derived_ms = Vec::new();
        let mut tiles_total = 0u64;
        let mut cpu_ref_ms = 0.0f32;
        doc.begin_stroke(name, FieldKind::Elevation);
        for dabs in &batches {
            let t = Instant::now();
            profiler.begin_frame();
            let mut enc = gpu.device.create_command_encoder(&Default::default());
            let mut rect = PixelRect::EMPTY;
            for d in dabs {
                rect = rect.union(&d.rect(size, size));
            }
            doc.stroke_will_touch(&rect);
            let mut dirty = doc.elevation.empty_tileset();
            let n = brush.encode(&gpu.queue, &mut enc, "elevation", &field, dabs, &mut dirty, &mut profiler);
            assert_eq!(n, dabs.len());
            doc.pending_readback_mut(FieldKind::Elevation).union_with(&dirty);
            field.encode_readback(&gpu.device, &mut enc, doc.pending_readback_mut(FieldKind::Elevation));
            profiler.end_frame(&mut enc);
            gpu.queue.submit([enc.finish()]);
            field.after_submit();
            profiler.after_submit();
            let submit_ms = ms(t);
            let t2 = Instant::now();
            let _ = gpu.device.poll(wgpu::PollType::wait_indefinitely());
            let landed = field.collect(&mut doc.elevation);
            tiles_total += landed.len() as u64;
            readback_ms.push(ms(t2));
            let t3 = Instant::now();
            let mut ts = doc.elevation.empty_tileset();
            for &t in &landed {
                ts.insert_index(t);
            }
            stats.update(&doc.elevation, &ts, 0.0);
            derived_ms.push(ms(t3));
            frame_ms.push(submit_ms + readback_ms.last().unwrap());
            let t4 = Instant::now();
            let _r: PixelRect = apply_dabs(&mut reference, dabs);
            cpu_ref_ms += ms(t4);
            profiler.poll();
        }
        doc.end_stroke();
        let mut pending = doc.pending_readback_mut(FieldKind::Elevation).take();
        field.flush(&gpu.device, &gpu.queue, &mut doc.elevation, &mut pending);
        let finalized = doc.try_finalize_strokes(field.has_in_flight());
        assert_eq!(finalized, 1, "stroke should produce one undo entry");
        let avg = frame_ms.iter().sum::<f32>() / frame_ms.len() as f32;
        let max = frame_ms.iter().cloned().fold(0.0, f32::max);
        let rb = readback_ms.iter().sum::<f32>() / readback_ms.len() as f32;
        let dv = derived_ms.iter().sum::<f32>() / derived_ms.len() as f32;
        let mut max_diff = 0.0f32;
        for (a, b) in doc.elevation.data().iter().zip(reference.data()) {
            max_diff = max_diff.max((a - b).abs());
        }
        println!(
            "{name:7} stroke: {} dabs r={radius:.0} in {frames} frames: encode+submit+readback avg {avg:7.2} ms, max {max:7.2} ms; readback wait avg {rb:6.2} ms; derived avg {dv:6.3} ms; {tiles_total} tiles ({:.1} MiB) synced; CPU reference {:.1} ms/frame; max |GPU-CPU| = {max_diff:.5}",
            frames * per_frame,
            tiles_total as f64 * 16384.0 / 1048576.0,
            cpu_ref_ms / frames as f32
        );
        if let Some(gpu_ms) = profiler.gpu_ms.get("brush") {
            println!("         GPU timestamp for last brush dispatch: {gpu_ms:.3} ms");
        }
        if max_diff > 1e-2 {
            bail!("GPU/CPU mismatch too large: {max_diff}");
        }
    }

    // Undo both strokes: mirror deltas → GPU upload → full readback must
    // reproduce the original terrain exactly.
    let t = Instant::now();
    let mut uploaded = 0usize;
    while let Some(step) = doc.undo() {
        if let Some((_, tiles)) = step {
            uploaded += tiles.len();
            field.upload_tiles(&gpu.queue, &doc.elevation, tiles.into_iter());
        }
    }
    let undo_ms = ms(t);
    println!("undo 2 strokes ({uploaded} tile uploads, {:.1} MiB history): {undo_ms:6.1} ms", doc.undo.loaded_bytes() as f64 / 1048576.0);
    if doc.elevation.data() != original.data() {
        bail!("undo did not restore the mirror exactly");
    }

    // Procedural brushes on the CPU (ridge, coast) over a long diagonal stroke.
    {
        let path: Vec<[f32; 2]> = (0..40).map(|i| {
            let k = i as f32 / 39.0;
            [size as f32 * (0.2 + 0.6 * k), size as f32 * (0.3 + 0.4 * k) + (k * 12.0).sin() * size as f32 * 0.03]
        }).collect();
        let mut f = original.clone();
        let rp = isoline_core::procedural::RidgeParams { width: size as f32 / 40.0, ..Default::default() };
        let t = Instant::now();
        let r = isoline_core::procedural::apply_ridge(&mut f, &path, &rp);
        println!("ridge brush ({} texel rect):     {:8.1} ms", r.area(), ms(t));
        let mut f = original.clone();
        let cp = isoline_core::procedural::CoastParams { band: size as f32 / 24.0, ..Default::default() }.with_preset(isoline_core::procedural::CoastPreset::Fjord);
        let t = Instant::now();
        let r = isoline_core::procedural::apply_coast(&mut f, &path, 0.0, &cp);
        println!("coast brush ({} texel rect):     {:8.1} ms", r.area(), ms(t));
    }

    // Full-field readback throughput (what a global GPU pass would cost to mirror).
    let t = Instant::now();
    let mut all = doc.elevation.empty_tileset();
    all.fill();
    let total = all.len();
    let landed = field.flush(&gpu.device, &gpu.queue, &mut doc.elevation, &mut all);
    let dt = ms(t);
    println!(
        "full readback of {} tiles ({:.0} MiB):     {:8.1} ms  ({:.2} GiB/s)",
        landed.len(),
        total as f64 * 16384.0 / 1048576.0,
        dt,
        total as f64 * 16384.0 / (dt as f64 / 1000.0) / (1u64 << 30) as f64
    );
    if doc.elevation.data() != original.data() {
        bail!("GPU field after undo does not match the original terrain");
    }
    println!("GPU field after undo matches original terrain bit-exactly");
    println!("device bytes for field + staging: {:.1} MiB", field.device_bytes as f64 / 1048576.0);
    if let Some(b) = gpu.allocated_bytes() {
        println!("allocator report total: {:.1} MiB", b as f64 / 1048576.0);
    }
    Ok(())
}
