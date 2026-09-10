//! Dependency graph with dirty-region propagation.
//!
//! Every derived quantity in the map (hillshade, coastline, later rivers,
//! moisture, biomes, forests…) is a node. Each node declares the nodes it
//! reads and, per edge, how far its kernel reaches: a smooth pass reaches one
//! texel, an orographic pass reaches its advection distance, and flow
//! accumulation reaches the whole map. When a source is edited only the
//! affected tiles are marked dirty; [`DepGraph::propagate`] walks the graph in
//! topological order and grows each dirty set by the consumer's reach, so
//! every node knows exactly which tiles it must recompute.
//!
//! The graph does not run the recomputation itself: the owner of each node
//! calls [`DepGraph::take_dirty`] and does the work (on the GPU, on a rayon
//! job, or inline). That keeps this module free of any GPU or threading
//! dependency and lets long-running nodes swap their results in atomically.

use crate::field::TILE;
use crate::tiles::TileSet;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub struct NodeId(pub u32);

/// How far a consumer's kernel reaches into its input.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reach {
    /// Radius in field pixels; the dirty set grows by `ceil(px / TILE)` tiles.
    Local(u32),
    /// Any change anywhere invalidates the whole output (e.g. flow accumulation).
    Global,
}

#[derive(Clone, Debug)]
pub struct Edge {
    pub from: NodeId,
    pub reach: Reach,
}

#[derive(Clone, Debug)]
pub struct NodeDef {
    pub name: String,
    pub inputs: Vec<Edge>,
}

#[derive(Debug)]
pub struct DepGraph {
    nodes: Vec<NodeDef>,
    dirty: Vec<TileSet>,
    /// Topological order, recomputed when nodes are added.
    order: Vec<NodeId>,
    tiles_x: u32,
    tiles_y: u32,
    /// Monotonic counter bumped every time anything is marked dirty; cheap
    /// "did the world change" check for the renderer.
    generation: u64,
}

impl DepGraph {
    pub fn new(field_width: u32, field_height: u32) -> Self {
        Self {
            nodes: Vec::new(),
            dirty: Vec::new(),
            order: Vec::new(),
            tiles_x: field_width.div_ceil(TILE),
            tiles_y: field_height.div_ceil(TILE),
            generation: 0,
        }
    }

    pub fn add_node(&mut self, name: impl Into<String>, inputs: Vec<Edge>) -> NodeId {
        let id = NodeId(self.nodes.len() as u32);
        for e in &inputs {
            assert!((e.from.0 as usize) < self.nodes.len(), "edge references unknown node");
        }
        self.nodes.push(NodeDef { name: name.into(), inputs });
        self.dirty.push(TileSet::new(self.tiles_x, self.tiles_y));
        self.recompute_order();
        id
    }

    pub fn name(&self, id: NodeId) -> &str {
        &self.nodes[id.0 as usize].name
    }
    pub fn node_count(&self) -> usize {
        self.nodes.len()
    }
    pub fn generation(&self) -> u64 {
        self.generation
    }
    pub fn order(&self) -> &[NodeId] {
        &self.order
    }

    fn recompute_order(&mut self) {
        // Nodes can only reference earlier nodes (enforced in add_node), so
        // insertion order is already topological.
        self.order = (0..self.nodes.len() as u32).map(NodeId).collect();
    }

    /// Mark tiles dirty on a node. Usually called on a source node after an edit.
    pub fn mark_dirty(&mut self, id: NodeId, tiles: &TileSet) {
        if tiles.is_empty() {
            return;
        }
        self.dirty[id.0 as usize].union_with(tiles);
        self.generation += 1;
    }

    pub fn mark_all_dirty(&mut self, id: NodeId) {
        self.dirty[id.0 as usize].fill();
        self.generation += 1;
    }

    /// Push dirtiness downstream. After this call every node's dirty set
    /// includes everything it must recompute given its inputs' dirty sets.
    /// Dirty sets on inputs are *not* cleared: each node owner clears its own
    /// via [`take_dirty`](Self::take_dirty) once it has recomputed.
    pub fn propagate(&mut self) {
        for i in 0..self.order.len() {
            let id = self.order[i];
            let inputs = self.nodes[id.0 as usize].inputs.clone();
            for e in inputs {
                let src = &self.dirty[e.from.0 as usize];
                if src.is_empty() {
                    continue;
                }
                let grown = match e.reach {
                    Reach::Local(px) => src.dilated(px.div_ceil(TILE)),
                    Reach::Global => {
                        let mut all = TileSet::new(self.tiles_x, self.tiles_y);
                        all.fill();
                        all
                    }
                };
                self.dirty[id.0 as usize].union_with(&grown);
            }
        }
    }

    pub fn dirty(&self, id: NodeId) -> &TileSet {
        &self.dirty[id.0 as usize]
    }

    pub fn is_dirty(&self, id: NodeId) -> bool {
        !self.dirty[id.0 as usize].is_empty()
    }

    /// Take and clear a node's dirty set. The owner recomputes those tiles.
    pub fn take_dirty(&mut self, id: NodeId) -> TileSet {
        self.dirty[id.0 as usize].take()
    }

    pub fn clear_dirty(&mut self, id: NodeId) {
        self.dirty[id.0 as usize].clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_reach_grows_by_kernel_radius() {
        let mut g = DepGraph::new(1024, 1024);
        let elev = g.add_node("elevation", vec![]);
        let smooth = g.add_node("smooth", vec![Edge { from: elev, reach: Reach::Local(1) }]);
        let wide = g.add_node("wide", vec![Edge { from: smooth, reach: Reach::Local(200) }]);
        let global = g.add_node("flow", vec![Edge { from: elev, reach: Reach::Global }]);

        let mut t = TileSet::for_field(1024, 1024);
        t.insert(8, 8);
        g.mark_dirty(elev, &t);
        g.propagate();

        assert_eq!(g.dirty(elev).len(), 1);
        assert_eq!(g.dirty(smooth).len(), 9);
        // 200px = 4 tiles reach applied on top of the 3x3 → 11x11
        assert_eq!(g.dirty(wide).len(), 121);
        assert_eq!(g.dirty(global).len(), 256);

        let taken = g.take_dirty(smooth);
        assert_eq!(taken.len(), 9);
        assert!(!g.is_dirty(smooth));
        // Source remains dirty until its owner clears it.
        assert!(g.is_dirty(elev));
    }
}
