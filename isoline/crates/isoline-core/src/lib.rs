//! Isoline core: the field engine.
//!
//! Everything in this crate is CPU-only and GPU-agnostic. It owns:
//!
//! * [`field`]   — scalar fields (`f32` rasters) with 64×64 *tile* bookkeeping.
//!   Tiles are an internal scheduling and transfer unit only; they never define
//!   terrain and are invisible to the user.
//! * [`tiles`]   — dense bitsets of tiles used as dirty regions.
//! * [`graph`]   — the dependency graph with dirty-region propagation.
//! * [`brush`]   — stroke sampling, falloff kernels, blend modes, and a CPU
//!   reference implementation of the brush kernel that the WGSL shader mirrors.
//! * [`undo`]    — a command stack storing sparse per-tile deltas, spilling old
//!   history to disk.
//! * [`terrain`] — initial terrain synthesis (fBm / domain warp) for new projects.
//! * [`project`] — the on-disk project format and autosave/recovery.
//! * [`stats`]   — incremental per-tile field statistics.
//! * [`water`]   — the water system boundary: moisture + hydrology at a capped
//!   simulation resolution, exposing rivers, lake polygons and moisture only.
//! * [`hydrology`], [`climate`], [`biome`], [`derived`] — fill/flow/lakes/rivers
//!   (internal), moisture and temperature, biome classification, and the chain.

pub mod biome;
pub mod brush;
pub mod climate;
pub mod derived;
pub mod field;
pub mod geometry;
pub mod graph;
pub mod hydrology;
pub mod noise;
pub mod procedural;
pub mod project;
pub mod stats;
pub mod terrain;
pub mod tiles;
pub mod undo;
pub mod water;

pub use field::{ScalarField, TILE};
pub use tiles::{PixelRect, TileSet};
