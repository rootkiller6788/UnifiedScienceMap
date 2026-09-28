"""Flatten the nested tree into compact parallel arrays for the radial map.

Angles are computed here rather than in the browser so the layout is
deterministic and testable. Each leaf owns one equal slice of the circle; an
internal node sits midway between its first and last child -- the standard
radial-dendrogram convention, which keeps the edges to its outermost children
symmetric. Wedges are therefore proportional to leaf count, so a cluster's arc
on screen is proportional to how much taxonomy it contains.

Pure module: no I/O, no globals, no randomness.
"""

from __future__ import annotations

import math
from typing import Any


def build_layout(nested: list[dict], *, root_name: str = "All Philosophy") -> dict[str, Any]:
    """Turn a nested tree into parallel arrays plus a per-cluster summary.

    ``nested[0]`` is the root; each of its children becomes one colour-coded
    cluster. All returned arrays are indexed by node id and share a length.

    ``ids`` carries the source category id and ``crossParents`` the DAG parents
    other than the one this tree descends from -- together they let the map
    report a node's cross-listings without re-reading the tree.
    """
    names: list[str] = []
    ids: list[str] = []           # source category id, for the DAG cross-links
    cross_parents: list[tuple[str, ...]] = []   # DAG parents besides the tree one
    depth: list[int] = []
    parent: list[int] = []
    cluster: list[int] = []
    size: list[int] = []          # subtree node count, to size the mark
    leaf_count: list[int] = []
    first_child: list[int] = []
    last_child: list[int] = []
    leaf_slot: list[int] = []     # position around the circle, leaves only

    root = nested[0]
    top_level = root.get("children", [])
    clusters: list[dict[str, Any]] = [
        {"name": top["name"], "index": i, "nodeCount": 0, "leafCount": 0}
        for i, top in enumerate(top_level)
    ]

    next_slot = [0]

    def walk(node: dict, level: int, parent_id: int, cluster_id: int) -> int:
        node_id = len(names)
        names.append(node["name"])
        ids.append(str(node.get("id", "")))
        # The nested tree keeps every DAG parent; drop the one we actually
        # descended from and what remains is the cross-listing.
        tree_parent_id = ids[parent_id] if parent_id >= 0 else None
        cross_parents.append(tuple(
            pid for pid in (node.get("parentIds") or ()) if str(pid) != tree_parent_id
        ))
        depth.append(level)
        parent.append(parent_id)
        cluster.append(cluster_id)
        size.append(1)
        leaf_count.append(0)
        first_child.append(-1)
        last_child.append(-1)
        leaf_slot.append(-1)

        children = node.get("children", [])
        if not children:
            leaf_slot[node_id] = next_slot[0]
            next_slot[0] += 1
            leaf_count[node_id] = 1
            return node_id

        for index, child in enumerate(children):
            # A top-level node is its own cluster; everything below inherits it.
            child_cluster = index if level == 0 else cluster_id
            child_id = walk(child, level + 1, node_id, child_cluster)
            if index == 0:
                first_child[node_id] = child_id
            last_child[node_id] = child_id
            leaf_count[node_id] += leaf_count[child_id]
            size[node_id] += size[child_id]
        return node_id

    walk(root, 0, -1, -1)

    total_leaves = max(next_slot[0], 1)
    step = 2.0 * math.pi / total_leaves

    angle = [0.0] * len(names)
    for node_id, slot in enumerate(leaf_slot):
        if slot >= 0:
            angle[node_id] = (slot + 0.5) * step

    # Ids are assigned in pre-order, so every child has a higher id than its
    # parent: iterating backwards guarantees children are resolved first.
    for node_id in range(len(names) - 1, -1, -1):
        if first_child[node_id] >= 0:
            angle[node_id] = (angle[first_child[node_id]] + angle[last_child[node_id]]) / 2.0

    for index, top in enumerate(top_level):
        clusters[index]["leafCount"] = _leaves(top)
    for node_id in range(len(names)):
        cluster_id = cluster[node_id]
        if cluster_id >= 0:
            clusters[cluster_id]["nodeCount"] += 1

    return {
        "names": names,
        "ids": ids,
        "crossParents": cross_parents,
        "depth": depth,
        "parent": parent,
        "cluster": cluster,
        "angle": angle,
        "size": size,
        "leafCount": leaf_count,
        "clusters": clusters,
        "maxDepth": max(depth, default=0),
        "totalLeaves": total_leaves,
        "rootName": root_name,
    }


def _leaves(node: dict) -> int:
    children = node.get("children", [])
    if not children:
        return 1
    return sum(_leaves(child) for child in children)
