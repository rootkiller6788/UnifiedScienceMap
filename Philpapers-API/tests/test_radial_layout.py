"""Tests for the radial layout: structure, angle invariants, cluster wedges."""

import json
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import radial_layout  # noqa: E402


@pytest.fixture
def simple():
    """root -> A -> (A1, A2), root -> B."""
    return [{
        "id": "1", "name": "Root",
        "children": [
            {"id": "10", "name": "A", "children": [
                {"id": "11", "name": "A1", "children": []},
                {"id": "12", "name": "A2", "children": []},
            ]},
            {"id": "20", "name": "B", "children": []},
        ],
    }]


def test_arrays_are_parallel(simple):
    layout = radial_layout.build_layout(simple)
    lengths = {len(layout[key]) for key in
               ("names", "depth", "parent", "cluster", "angle", "size", "leafCount")}
    assert len(lengths) == 1
    assert lengths == {5}          # Root, A, A1, A2, B


def test_leaf_angles_are_evenly_spaced(simple):
    layout = radial_layout.build_layout(simple)
    leaves = [i for i, f in enumerate(layout["leafCount"]) if layout["leafCount"][i] == 1
              and layout["size"][i] == 1]
    angles = sorted(layout["angle"][i] for i in leaves)
    assert len(angles) == 3
    gaps = [angles[1] - angles[0], angles[2] - angles[1]]
    assert gaps[0] == pytest.approx(gaps[1])


def test_internal_angle_is_midpoint_of_first_and_last_child(simple):
    layout = radial_layout.build_layout(simple)
    parent, angle, first, last = (
        layout["parent"], layout["angle"], layout["depth"], layout["leafCount"])
    kids = {}
    for child, par in enumerate(parent):
        if par >= 0:
            kids.setdefault(par, []).append(child)
    for par, children in kids.items():
        expected = (angle[children[0]] + angle[children[-1]]) / 2
        assert angle[par] == pytest.approx(expected)


def test_root_sits_between_its_extreme_children(simple):
    layout = radial_layout.build_layout(simple)
    angle = layout["angle"]
    # A is node 1, B is node 4; the root takes the midpoint of those two.
    assert angle[0] == pytest.approx((angle[1] + angle[4]) / 2)
    assert angle[1] < angle[0] < angle[4]


def test_clusters_are_the_top_level_children(simple):
    layout = radial_layout.build_layout(simple)
    assert [c["name"] for c in layout["clusters"]] == ["A", "B"]
    assert layout["cluster"][0] == -1          # root belongs to no cluster
    assert layout["cluster"][1] == 0           # A
    assert layout["cluster"][2] == 0           # A1, inherits A
    assert layout["cluster"][3] == 0           # A2, inherits A
    assert layout["cluster"][4] == 1           # B


def test_ids_follow_the_tree(simple):
    layout = radial_layout.build_layout(simple)
    assert layout["ids"] == ["1", "10", "11", "12", "20"]
    assert layout["crossParents"] == [(), (), (), (), ()]


def test_cross_parents_keep_the_dag_parents_but_not_the_tree_one():
    nested = [{"id": "1", "name": "Root", "children": [
        {"id": "10", "name": "A", "parentIds": ["1"], "children": [
            {"id": "11", "name": "A1", "parentIds": ["10", "20"], "children": []},
        ]},
        {"id": "20", "name": "B", "parentIds": ["1"], "children": []},
    ]}]
    layout = radial_layout.build_layout(nested)
    # A1 is reached through A (10), so 20 is left over as a cross-listing.
    assert layout["crossParents"][2] == ("20",)
    assert layout["crossParents"][1] == ()


def test_single_node_tree():
    layout = radial_layout.build_layout([{"id": "1", "name": "Only", "children": []}])
    assert layout["totalLeaves"] == 1
    assert layout["maxDepth"] == 0
    assert layout["clusters"] == []


# --------------------------------------------------------------------------
# Against the real snapshot
# --------------------------------------------------------------------------

@pytest.fixture(scope="module")
def real_layout(repo_root):
    path = repo_root / "data" / "categories.raw.json"
    tree_path = repo_root / "output" / "philpapers-taxonomy.json"
    if not tree_path.exists():
        pytest.skip("run the pipeline first to produce output/philpapers-taxonomy.json")
    nested = json.loads(tree_path.read_text(encoding="utf-8"))
    return radial_layout.build_layout(nested)


def test_real_counts(real_layout):
    assert len(real_layout["names"]) == 6135
    assert real_layout["totalLeaves"] == 5026
    assert real_layout["maxDepth"] == 8
    assert len(real_layout["clusters"]) == 7


def test_real_root_sits_between_its_extreme_clusters(real_layout):
    # The root is drawn at radius 0, so its angle is cosmetic -- but it must
    # still obey the convention: midway between its first and last child.
    angle = real_layout["angle"]
    kids = [i for i, p in enumerate(real_layout["parent"]) if p == 0]
    assert len(kids) == 7
    assert angle[0] == pytest.approx((angle[kids[0]] + angle[kids[-1]]) / 2)
    assert 0 < angle[0] < 2 * math.pi


def test_every_angle_lies_in_range(real_layout):
    assert all(0.0 <= a <= 2 * math.pi for a in real_layout["angle"])


def test_real_children_are_angle_monotonic(real_layout):
    kids = {}
    for child, parent in enumerate(real_layout["parent"]):
        if parent >= 0:
            kids.setdefault(parent, []).append(child)
    angle = real_layout["angle"]
    for children in kids.values():
        assert all(angle[children[i]] < angle[children[i + 1]]
                   for i in range(len(children) - 1))


def test_every_internal_node_sits_between_its_children(real_layout):
    angle, parent = real_layout["angle"], real_layout["parent"]
    kids = {}
    for child, par in enumerate(parent):
        if par >= 0:
            kids.setdefault(par, []).append(child)
    for par, children in kids.items():
        expected = (angle[children[0]] + angle[children[-1]]) / 2
        assert angle[par] == pytest.approx(expected, abs=1e-9)
        assert angle[children[0]] <= angle[par] <= angle[children[-1]]


def test_real_cross_links_survive_the_tree(real_layout):
    # Every one of the 1,295 multi-parent categories must still show a
    # cross-listing after the tree picked one parent to descend from.
    assert sum(1 for c in real_layout["crossParents"] if c) == 1295
    assert sum(len(c) for c in real_layout["crossParents"]) >= 1295


def test_real_ids_are_unique(real_layout):
    assert len(set(real_layout["ids"])) == len(real_layout["ids"]) == 6135


def test_cluster_leaf_counts_sum_to_total(real_layout):
    assert sum(c["leafCount"] for c in real_layout["clusters"]) == real_layout["totalLeaves"]
    assert sum(c["nodeCount"] for c in real_layout["clusters"]) == 6134  # all but the root


def test_depths_are_consistent(real_layout):
    for node, parent in enumerate(real_layout["parent"]):
        if parent >= 0:
            assert real_layout["depth"][node] == real_layout["depth"][parent] + 1


def test_dfs_ids_are_preorder(real_layout):
    # The reversed-iteration angle pass depends on children having higher ids.
    for node, parent in enumerate(real_layout["parent"]):
        if parent >= 0:
            assert node > parent
