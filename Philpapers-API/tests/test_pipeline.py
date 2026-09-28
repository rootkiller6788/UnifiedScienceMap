"""Assertions against the real snapshot, plus an end-to-end pipeline run.

These numbers are measured from the actual 6,134-record payload, so they are
hard assertions rather than placeholders: if any of them changes, the parser is
misreading the data.
"""

import json
import re

import pytest

import build_tree as bt
import pipeline

RECORDS = 6134
NODES = 6135          # 6,134 records + the synthesized root
TOP_LEVEL = 7
CROSS_LISTED = 1295
MAX_DEPTH = 8
REPAIRED_NAMES = 31


@pytest.fixture(scope="module")
def raw(repo_root):
    path = repo_root / "data" / "categories.raw.json"
    if not path.exists():
        pytest.skip(f"snapshot not present at {path}; run with --fetch first")
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def built(raw):
    records, problems = bt.parse_records(raw)
    return bt.build_forest(records, prior_problems=problems), records


def test_record_count_and_shape(raw):
    assert len(raw) == RECORDS
    assert all(isinstance(r, list) and len(r) == 4 for r in raw)
    assert all(
        isinstance(r[0], str) and isinstance(r[1], int)
        and isinstance(r[2], str) and isinstance(r[3], int)
        for r in raw
    )


def test_root_is_synthesized_and_holds_seven_clusters(built):
    result, _ = built
    assert result.roots == ["1"]
    assert result.nodes["1"]["name"] == "All Philosophy"
    assert result.nodes["1"]["synthetic"] is True
    assert len(result.nodes["1"]["children"]) == TOP_LEVEL
    assert result.stats["roots"] == 1


def test_all_nodes_reachable_from_the_root(built):
    result, _ = built
    assert result.stats["nodes"] == NODES
    assert result.stats["reachable"] == NODES


def test_tree_is_acyclic_and_has_no_dangling_parents(built):
    result, _ = built
    assert result.stats["cyclesBroken"] == 0
    assert result.stats["danglingPromoted"] == 0
    kinds = {p.kind for p in result.problems}
    assert bt.CYCLE not in kinds
    assert bt.DANGLING_PARENT not in kinds
    assert bt.DUPLICATE_ID not in kinds


def test_depth_and_cross_listing_match_the_source(built):
    result, _ = built
    assert result.stats["maxDepth"] == MAX_DEPTH
    assert result.stats["multiParent"] == CROSS_LISTED


def test_every_primary_parent_is_among_its_parents(raw):
    for name, _id, parents, primary in raw:
        assert str(primary) in parents.split(","), f"{name!r} ({_id})"


def test_mojibake_repair_applies_to_every_non_ascii_name(raw, built):
    result, records = built
    assert result.stats["records"] == RECORDS
    repaired = [p for p in result.problems if p.kind == bt.MOJIBAKE_REPAIRED]
    assert len(repaired) == REPAIRED_NAMES
    # Every source name that was non-ASCII came back clean.
    assert all(r.name.isascii() or "Ã" not in r.name for r in records)
    names = {n["name"] for n in result.flat.values()}
    for expected in ("René Descartes", "Søren Kierkegaard", "Henri Poincaré",
                     "Émilie du Châtelet", "Ōmori Shōzō", "Nishida Kitarō"):
        assert expected in names


def test_known_data_defects_are_reported_not_hidden(built):
    result, _ = built
    kinds = {p.kind for p in result.problems}
    assert bt.SYNTHETIC_ROOT in kinds
    # One source category genuinely has an empty name; keep it, label it.
    empties = [p for p in result.problems if p.kind == bt.EMPTY_NAME]
    assert len(empties) == 1 and empties[0].ids == ("510734",)
    assert result.nodes["510734"]["name"] == "(untitled 510734)"


def test_cross_listed_node_keeps_all_parents(built):
    result, _ = built
    node = result.nodes["19"]           # Metaphysics of Mind
    assert node["parentIds"] == ["492730", "5986", "16"]
    assert node["primaryParentId"] == "16"
    # Navigates under exactly one parent, not all three.
    assert result.nodes["19"]["name"] == "Metaphysics of Mind"


def test_flat_paths_reconstruct_the_hierarchy(built):
    result, _ = built
    deepest = max(result.flat.values(), key=lambda n: n["depth"])
    assert deepest["depth"] == MAX_DEPTH
    assert deepest["path"].count(" > ") == MAX_DEPTH
    assert deepest["path"].startswith("All Philosophy > ")


def test_run_writes_every_artifact(repo_root, tmp_path):
    raw_path = repo_root / "data" / "categories.raw.json"
    if not raw_path.exists():
        pytest.skip("snapshot not present")

    report = pipeline.run(raw_path=raw_path, out_dir=tmp_path)

    for name in ("philpapers-taxonomy.json", "taxonomy-flat.json", "report.json", "map.html"):
        assert (tmp_path / name).stat().st_size > 0, f"{name} is empty"

    assert report["recordCount"] == RECORDS
    assert report["stats"]["nodes"] == NODES

    nested = json.loads((tmp_path / "philpapers-taxonomy.json").read_text(encoding="utf-8"))
    flat = json.loads((tmp_path / "taxonomy-flat.json").read_text(encoding="utf-8"))

    def count(nodes):
        return sum(1 + count(n["children"]) for n in nodes)

    assert count(nested) == NODES
    assert len(flat) == NODES

    html = (tmp_path / "map.html").read_text(encoding="utf-8")
    assert html.lower().startswith("<!doctype html>")
    assert 'charset="utf-8"' in html
    assert re.search(r'<canvas\b', html), "the map should render to a canvas"
    # Data is inlined, not fetched: no external URLs, and the script block
    # cannot be closed early by a category name containing "</".
    assert "http://" not in html and "https://" not in html
    assert "</script>" in html and html.count("<script") == 2
