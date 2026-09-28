"""Tests for the chord layout: the accounting, and the branch/self-loop split.

The chord data has one job before any of it is drawn: account for every extra
parent edge. A category with three parents produces two of them, and each has to
end up either as a chord between two branches or as a self-loop inside one. If
the totals do not add up, the picture is quietly missing part of the DAG -- and
a chord diagram with a few edges dropped looks exactly as convincing as a
correct one.

So the numbers below are the ones this module exists to get right.
"""

import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import chord_layout  # noqa: E402

RECORDS = 6134
NODES = 6135                 # the snapshot plus the synthesized root
CROSS_LISTED = 1295
PARENT_PAIRS = 1616          # every extra parent edge, i.e. one chord's worth each
BRANCHES_USED = 42
BRANCHES_TOTAL = 49
DOMAINS = 7


@pytest.fixture
def nested():
    """root -> A -> A1 -> (L1, L2, L4, A1b);  root -> B -> B1 -> (L3,).

    L2 is filed under A1 *and* B1 -- two different branches, so it is a chord.
    L4 is filed under A1 *and* A1b -- two parents, but the same branch, so it is
    a self-loop. Both are needed: the split between them is what the module is
    for, and a fixture with only one of them cannot test it.
    """
    return [{
        "id": "1", "name": "Root", "parentIds": [], "synthetic": True,
        "children": [
            {"id": "10", "name": "A", "parentIds": ["1"], "primaryParentId": "1",
             "children": [
                 {"id": "11", "name": "A1", "parentIds": ["10"], "primaryParentId": "10",
                  "children": [
                      {"id": "12", "name": "L1", "parentIds": ["11"], "primaryParentId": "11",
                       "children": []},
                      {"id": "13", "name": "L2", "parentIds": ["11", "21"],
                       "primaryParentId": "11", "children": []},
                      {"id": "14", "name": "L4", "parentIds": ["11", "15"],
                       "primaryParentId": "11", "children": []},
                      {"id": "15", "name": "A1b", "parentIds": ["11"], "primaryParentId": "11",
                       "children": []},
                  ]},
             ]},
            {"id": "20", "name": "B", "parentIds": ["1"], "primaryParentId": "1",
             "children": [
                 {"id": "21", "name": "B1", "parentIds": ["20"], "primaryParentId": "20",
                  "children": [
                      {"id": "22", "name": "L3", "parentIds": ["21"], "primaryParentId": "21",
                       "children": []},
                  ]},
             ]},
        ],
    }]


# ------------------------------------------------------------- the synthetic case

def test_chord_runs_between_the_two_branches(nested):
    out = chord_layout.build_chord(nested)
    assert out["meta"]["chords"] == 1
    chord = out["chords"][0]
    assert chord["name"] == "L2"
    assert (chord["s"], chord["t"]) == (0, 1)      # A1 -> B1
    assert chord["depth"] == 3                     # root, A, A1, then L2


def test_a_second_parent_in_the_same_branch_is_a_loop_not_a_chord(nested):
    out = chord_layout.build_chord(nested)
    assert out["meta"]["loops"] == 1
    assert out["meta"]["chords"] == 1
    loop = out["loops"][0]
    assert loop["b"] == 0                          # A1
    assert loop["count"] == 1
    assert loop["examples"][0][0] == "L4"
    assert "L4" not in [c["name"] for c in out["chords"]]


def test_loop_weight_counts_towards_its_branch(nested):
    out = chord_layout.build_chord(nested)
    a1, b1 = out["branches"][0], out["branches"][1]
    assert a1["degree"] == 2                       # one chord end + one self-loop
    assert a1["loops"] == 1
    assert b1["degree"] == 1
    assert b1["loops"] == 0


def test_branches_with_no_cross_listing_get_no_arc(nested):
    out = chord_layout.build_chord(nested)
    # A and B are depth-1 -- the domains. Their children A1 and B1 are the
    # branches, and both happen to carry weight here.
    assert out["meta"]["branchesTotal"] == 2
    assert out["meta"]["branches"] == 2
    assert [b["name"] for b in out["branches"]] == ["A1", "B1"]
    assert [d["name"] for d in out["domains"]] == ["A", "B"]


def test_an_unused_branch_is_still_carried(nested):
    # Branches are addressed by index, so the list must keep every branch even
    # when it carries no weight -- dropping one would silently shift every
    # index after it.
    out = chord_layout.build_chord(nested)
    assert len(out["branches"]) == out["meta"]["branchesTotal"]
    assert all("degree" in b for b in out["branches"])


def test_chords_are_sorted_by_partner_so_bundles_stay_contiguous():
    # The renderer walks each arc's chords in order and assumes same-partner
    # chords are adjacent; if that stops holding, bundles fragment silently.
    nested = [{
        "id": "1", "name": "Root", "parentIds": [], "children": [
            {"id": "10", "name": "A", "parentIds": ["1"], "primaryParentId": "1", "children": [
                {"id": "11", "name": "A1", "parentIds": ["10"], "primaryParentId": "10",
                 "children": [
                     {"id": "12", "name": "zeta", "parentIds": ["11", "31"],
                      "primaryParentId": "11", "children": []},
                     {"id": "13", "name": "alpha", "parentIds": ["11", "21"],
                      "primaryParentId": "11", "children": []},
                 ]},
            ]},
            {"id": "20", "name": "B", "parentIds": ["1"], "primaryParentId": "1", "children": [
                {"id": "21", "name": "B1", "parentIds": ["20"], "primaryParentId": "20",
                 "children": []},
            ]},
            {"id": "30", "name": "C", "parentIds": ["1"], "primaryParentId": "1", "children": [
                {"id": "31", "name": "C1", "parentIds": ["30"], "primaryParentId": "30",
                 "children": []},
            ]},
        ],
    }]
    out = chord_layout.build_chord(nested)
    keys = [(c["s"], c["t"]) for c in out["chords"]]
    assert keys == sorted(keys)
    # Partner is the primary sort key, so both of A1's chords come before any
    # chord to the other partner.
    assert out["chords"][0]["name"] == "alpha"     # to B1, before C1


def test_empty_input_is_not_an_error():
    out = chord_layout.build_chord([])
    assert out["chords"] == [] and out["branches"] == []
    assert out["meta"]["chords"] == 0


def test_a_root_with_no_children_is_not_an_error():
    out = chord_layout.build_chord([{"id": "1", "name": "Root", "children": []}])
    assert out["meta"]["branches"] == 0
    assert out["palette"] == list(chord_layout.SERIES)


def test_palette_is_the_validated_series():
    out = chord_layout.build_chord([])
    assert chord_layout.SERIES == (
        "#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9")
    assert len(chord_layout.SERIES) == DOMAINS


# -------------------------------------------------------------- the real snapshot

@pytest.fixture
def real(repo_root):
    raw = repo_root / "data" / "categories.raw.json"
    if not raw.exists():
        pytest.skip("snapshot not present")
    sys.path.insert(0, str(repo_root / "src"))
    import build_tree as bt

    records, problems = bt.parse_records(json.loads(raw.read_text(encoding="utf-8")))
    return chord_layout.build_chord(bt.to_nested(bt.build_forest(records, prior_problems=problems)))


def test_real_accounting_closes_exactly(real):
    meta = real["meta"]
    # Every extra parent edge is either a chord between branches or a loop inside
    # one. Nothing may fall on the floor.
    assert meta["chords"] + meta["loops"] == meta["parentPairs"]
    assert meta["parentPairs"] == PARENT_PAIRS
    assert meta["crossListed"] == CROSS_LISTED
    assert meta["categories"] == NODES


def test_real_branch_counts(real):
    assert real["meta"]["branches"] == BRANCHES_USED
    assert real["meta"]["branchesTotal"] == BRANCHES_TOTAL
    assert len(real["domains"]) == DOMAINS
    assert all(b["degree"] > 0 for b in real["branches"] if b["degree"])


def test_real_degree_is_chord_ends_plus_loops(real):
    loops = {l["b"]: l["count"] for l in real["loops"]}
    ends = {}
    for c in real["chords"]:
        ends[c["s"]] = ends.get(c["s"], 0) + 1
        ends[c["t"]] = ends.get(c["t"], 0) + 1
    for i, b in enumerate(real["branches"]):
        assert b["degree"] == ends.get(i, 0) + loops.get(i, 0), b["name"]
        assert b["loops"] == loops.get(i, 0)


def test_real_total_degree_is_twice_the_chords_plus_loops(real):
    total = sum(b["degree"] for b in real["branches"])
    assert total == 2 * real["meta"]["chords"] + real["meta"]["loops"]


def test_real_no_chord_is_a_self_loop(real):
    # A same-branch pair must have been diverted into `loops`, never emitted as
    # a chord with s == t -- that would be an undrawable ribbon.
    assert all(c["s"] != c["t"] for c in real["chords"])


def test_real_every_chord_endpoints_exist(real):
    n = len(real["branches"])
    assert all(0 <= c["s"] < n and 0 <= c["t"] < n for c in real["chords"])
    assert all(real["branches"][c["s"]]["degree"] and real["branches"][c["t"]]["degree"]
               for c in real["chords"])


def test_real_loops_stay_inside_their_branch(real):
    assert all(real["loops"][i]["b"] == l["b"] for i, l in enumerate(real["loops"]))
    assert all(l["count"] > 0 and len(l["examples"]) > 0 for l in real["loops"])


def _pairs(real):
    counts = {}
    for c in real["chords"]:
        key = (min(c["s"], c["t"]), max(c["s"], c["t"]))
        counts[key] = counts.get(key, 0) + 1
    return counts


def test_real_the_biggest_exchange_is_mind_and_cognitive_science(real):
    (a, b), n = max(_pairs(real).items(), key=lambda kv: kv[1])
    names = {real["branches"][a]["name"], real["branches"][b]["name"]}
    assert names == {"Philosophy of Mind", "Philosophy of Cognitive Science"}
    assert n == 56


def test_real_most_of_the_structure_is_invisible_at_domain_level(real):
    # This is the finding the view exists to show. A domain-level chord diagram
    # draws 21 ribbons and cannot represent these at all, because both ends sit
    # inside the same top-level domain -- the edge never leaves the domain, so
    # at that resolution it is not an edge.
    counts = _pairs(real)
    within = {k: n for k, n in counts.items()
              if real["branches"][k[0]]["domain"] == real["branches"][k[1]]["domain"]}
    assert len(within) == 75
    assert sum(within.values()) == 441
    assert len(counts) == 234

    # The largest of them, and the third largest pair overall.
    (a, b), n = max(within.items(), key=lambda kv: kv[1])
    assert n == 39
    assert {real["branches"][a]["name"], real["branches"][b]["name"]} == \
        {"Applied Ethics", "Social and Political Philosophy"}


def test_real_branch_order_is_grouped_by_domain(real):
    # The renderer relies on this for the ring's colour bands: branches are
    # appended domain by domain, so ascending index is already ring order.
    domains = [b["domain"] for b in real["branches"]]
    assert domains == sorted(domains)


def test_real_branches_are_carried_even_when_unused(real):
    # `branches` holds all 49 so the renderer can map chords to arcs by index;
    # only the 42 with weight get drawn.
    assert len(real["branches"]) == BRANCHES_TOTAL
    assert sum(1 for b in real["branches"] if b["degree"]) == BRANCHES_USED


def test_real_no_parent_escapes_above_depth_two(real):
    # Every one of the 1,616 extra parents resolves to a depth-2 branch, so the
    # `beyond` bucket is empty. If this ever goes non-zero, a chord is being
    # dropped and the accounting test above would stop closing.
    assert real["meta"]["beyond"] == 0
