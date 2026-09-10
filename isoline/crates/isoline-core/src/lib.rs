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
//! * [`stats`]   — incremental per-tile field statistics (a first CPU-side
//!   derived node in the graph).

pub mod brush;
pub mod field;
pub mod graph;
pub mod noise;
pub mod project;
pub mod stats;
pub mod terrain;
pub mod tiles;
pub mod undo;

pub use field::{ScalarField, TILE};
pub use tiles::{PixelRect, TileSet};
