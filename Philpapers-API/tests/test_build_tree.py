"""Offline tests for the pure tree builder. No network, no API key."""

import json

import build_tree as bt


# --------------------------------------------------------------------------
# Encoding repair
# --------------------------------------------------------------------------

def test_repair_undoes_cp1252_mojibake():
    # "Gödelian" mangled by decoding UTF-8 bytes as CP1252.
    repaired, changed = bt.repair_encoding("GÃ¶delian Arguments")
    assert changed is True
    assert repaired == "Gödelian Arguments"


def test_repair_handles_undefined_cp1252_bytes():
    # Ō is U+014C -> UTF-8 c5 8c; CP1252 maps 0x8c to Œ. ō is U+014D -> c5 8d,
    # and CP1252 leaves 0x8d undefined, so the naive encode('cp1252')
    # round-trip raises. This is the case that broke the latin-1-only fix.
    assert bt.repair_encoding("ÅŒmori ShÅ\u008dzÅ\u008d")[0] == "Ōmori Shōzō"


def test_repair_handles_cp1252_high_range():
    # Ü -> c3 9c; CP1252 maps 0x9c to œ (not a control char, as latin-1 would).
    assert bt.repair_encoding("Frege: Ãœber Sinn und Bedeutung")[0] == (
        "Frege: Über Sinn und Bedeutung"
    )


def test_repair_never_touches_ascii():
    for name in ("Ethics", "Philosophy, Misc", ""):
        assert bt.repair_encoding(name) == (name, False)


def test_repair_leaves_correct_utf8_alone():
    # Already-correct UTF-8 must not be double-decoded.
    assert bt.repair_encoding("Gödelian") == ("Gödelian", False)


def test_repair_is_idempotent():
    once, _ = bt.repair_encoding("GÃ¶delian Arguments")
    assert bt.repair_encoding(once) == (once, False)


# --------------------------------------------------------------------------
# Normalization
# --------------------------------------------------------------------------

def test_normalize_ids_accepts_every_observed_shape():
    assert bt.normalize_ids("492730,5986,16") == ("492730", "5986", "16")
    assert bt.normalize_ids(" 5 , 6 ") == ("5", "6")
    assert bt.normalize_ids(7) == ("7",)
    assert bt.normalize_ids("7") == ("7",)
    assert bt.normalize_ids(["1", "2"]) == ("1", "2")
    assert bt.normalize_ids([1, 2]) == ("1", "2")
    assert bt.normalize_ids("") == ()
    assert bt.normalize_ids(None) == ()


def test_normalize_id_strips_padding_and_handles_ints():
    assert bt.normalize_id(" 16 ") == "16"
    assert bt.normalize_id(16) == "16"
    assert bt.normalize_id("") is None
    assert bt.normalize_id(None) is None


# --------------------------------------------------------------------------
# Parsing
# --------------------------------------------------------------------------

def test_parse_records_reads_the_real_shape(make_record):
    records, problems = bt.parse_records([make_record("Epistemology", 11, "10", 10)])
    assert len(records) == 1
    assert records[0].id == "11"
    assert records[0].name == "Epistemology"
    assert records[0].parent_ids == ("10",)
    assert records[0].primary_parent_id == "10"
    assert problems == []


def test_parse_records_reports_bad_records_without_dropping_the_rest(make_record):
    payload = [
        make_record("Good", 1, "", ""),
        ["Only Three", 2, "1"],
        ["Five", 3, "1", 1, "extra"],
        "not a record",
    ]
    records, problems = bt.parse_records(payload)
    assert [r.id for r in records] == ["1"]
    assert sum(1 for p in problems if p.kind == bt.BAD_RECORD) == 3


def test_parse_records_flags_empty_name(make_record):
    records, problems = bt.parse_records([make_record("", 91, "10", 10)])
    assert records[0].name == "(untitled 91)"
    assert [p.kind for p in problems] == [bt.EMPTY_NAME]


def test_parse_records_repairs_mojibake_and_keeps_the_raw_value(make_record):
    records, problems = bt.parse_records([make_record("RenÃ© Descartes", 1, "", "")])
    assert records[0].name == "René Descartes"
    assert records[0].name_raw == "RenÃ© Descartes"
    assert problems[0].kind == bt.MOJIBAKE_REPAIRED


def test_parse_records_notes_unexpected_field_types(make_record):
    _, problems = bt.parse_records([make_record("List Parents", 97, ["10", "20"], 10)])
    assert any(p.kind == bt.SHAPE_NOTE for p in problems)


def test_parse_records_handles_non_array_payload():
    records, problems = bt.parse_records({"not": "a list"})
    assert records == []
    assert problems[0].kind == bt.SHAPE_NOTE


# --------------------------------------------------------------------------
# Construction
# --------------------------------------------------------------------------

def _build(payload):
    records, problems = bt.parse_records(payload)
    return bt.build_forest(records, prior_problems=problems)


def test_synthesizes_missing_root(make_record):
    result = _build([make_record("Cluster", 10, "1", 1)])
    assert result.roots == ["1"]
    assert result.nodes["1"]["name"] == bt.ROOT_NAME
    assert result.nodes["1"]["synthetic"] is True
    assert any(p.kind == bt.SYNTHETIC_ROOT for p in result.problems)


def test_does_not_synthesize_root_when_unreferenced(make_record):
    result = _build([make_record("Standalone", 5, "", "")])
    assert result.roots == ["5"]
    assert "1" not in result.nodes


def test_builds_depth_and_path(make_record):
    result = _build([
        make_record("A", 10, "1", 1),
        make_record("B", 11, "10", 10),
        make_record("C", 12, "11", 11),
    ])
    assert result.flat["10"]["depth"] == 1
    assert result.flat["12"]["depth"] == 3
    assert result.flat["12"]["path"] == "All Philosophy > A > B > C"


def test_preserves_multi_parent_edges(make_record):
    result = _build([
        make_record("A", 10, "1", 1),
        make_record("B", 20, "1", 1),
        make_record("Cross", 21, "10,20", 10),
    ])
    # Navigates under the primary parent, but keeps both DAG edges.
    assert result.nodes["10"]["children"] == ["21"]
    assert result.nodes["21"]["parentIds"] == ["10", "20"]
    assert not any(p.kind == bt.PRIMARY_NOT_IN_PARENTS for p in result.problems)


def test_duplicate_id_keeps_first_and_reports(make_record):
    result = _build([
        make_record("First", 30, "1", 1),
        make_record("Second", 30, "1", 1),
    ])
    assert result.nodes["30"]["name"] == "First"
    duplicates = [p for p in result.problems if p.kind == bt.DUPLICATE_ID]
    assert len(duplicates) == 1
    assert "First" in duplicates[0].detail and "Second" in duplicates[0].detail


def test_dangling_parent_is_promoted_not_dropped(make_record):
    result = _build([make_record("Orphan", 40, "9999", 9999)])
    assert result.roots == ["40"]
    assert result.nodes["40"]["name"] == "Orphan"
    assert any(p.kind == bt.DANGLING_PARENT for p in result.problems)


def test_self_parent_becomes_root(make_record):
    result = _build([make_record("Selfish", 41, "41", 41)])
    assert result.roots == ["41"]
    assert any(p.kind == bt.SELF_PARENT for p in result.problems)


def test_breaks_two_cycle_at_smallest_id(make_record):
    result = _build([
        make_record("Cycle A", 50, "51", 51),
        make_record("Cycle B", 51, "50", 50),
    ])
    assert result.roots == ["50"]
    assert result.nodes["50"]["children"] == ["51"]
    cycle = [p for p in result.problems if p.kind == bt.CYCLE]
    assert len(cycle) == 1 and "50" in cycle[0].detail


def test_breaks_three_cycle_and_keeps_the_tail_reachable(make_record):
    result = _build([
        make_record("Three A", 60, "61", 61),
        make_record("Three B", 61, "62", 62),
        make_record("Three C", 62, "60", 60),
        make_record("Tail", 63, "61", 61),
    ])
    assert result.roots == ["60"]
    assert result.stats["reachable"] == 4
    assert result.flat["63"]["depth"] == 3  # 60 > 62 > 61 > 63


def test_reports_multiple_roots(make_record):
    result = _build([
        make_record("One", 10, "", ""),
        make_record("Two", 20, "", ""),
    ])
    assert result.roots == ["10", "20"]
    assert any(p.kind == bt.MULTIPLE_ROOTS for p in result.problems)


def test_reports_primary_parent_absent_from_parent_list(make_record):
    result = _build([
        make_record("A", 10, "1", 1),
        make_record("B", 20, "1", 1),
        make_record("Weird", 92, "10", 20),
    ])
    assert result.nodes["20"]["children"] == ["92"]
    assert any(p.kind == bt.PRIMARY_NOT_IN_PARENTS for p in result.problems)


def test_empty_input_yields_empty_tree():
    result = _build([])
    assert result.roots == []
    assert result.nodes == {}
    assert result.stats["maxDepth"] == 0


# --------------------------------------------------------------------------
# Projections
# --------------------------------------------------------------------------

def test_to_nested_is_recursive_and_keeps_ids(make_record):
    result = _build([
        make_record("A", 10, "1", 1),
        make_record("B", 11, "10", 10),
    ])
    nested = bt.to_nested(result)
    assert nested[0]["id"] == "1"
    assert nested[0]["children"][0]["id"] == "10"
    assert nested[0]["children"][0]["children"][0]["id"] == "11"


def test_to_flat_is_sorted_numerically(make_record):
    result = _build([make_record(f"C{i}", i, "1", 1) for i in (100, 9, 20)])
    assert list(bt.to_flat(result).keys()) == ["1", "9", "20", "100"]


def test_build_report_groups_problems_by_kind(make_record):
    result = _build([
        make_record("Orphan", 40, "9999", 9999),
        make_record("Selfish", 41, "41", 41),
    ])
    report = bt.build_report(result, source="test", record_count=2)
    assert report["recordCount"] == 2
    assert report["problemCounts"][bt.DANGLING_PARENT] == 1
    assert report["problemCounts"][bt.SELF_PARENT] == 1
    assert report["problems"][bt.DANGLING_PARENT][0]["ids"] == ["40"]


# --------------------------------------------------------------------------
# Integration over the whole fixture
# --------------------------------------------------------------------------

def test_fixture_builds_without_crashing(fixture_path):
    payload = json.loads(fixture_path.read_text(encoding="utf-8"))
    result = _build(payload)

    # 28 fixture records: the 2 malformed ones are skipped, the duplicate ID is
    # dropped, leaving 25 nodes plus the synthesized root.
    assert result.stats["records"] == 26
    assert result.stats["nodes"] == 26
    assert result.stats["reachable"] == result.stats["nodes"]

    kinds = {p.kind for p in result.problems}
    assert {
        bt.SYNTHETIC_ROOT,
        bt.DUPLICATE_ID,
        bt.DANGLING_PARENT,
        bt.SELF_PARENT,
        bt.CYCLE,
        bt.MULTIPLE_ROOTS,
        bt.EMPTY_NAME,
        bt.MOJIBAKE_REPAIRED,
        bt.SHAPE_NOTE,
        bt.BAD_RECORD,
        bt.PRIMARY_NOT_IN_PARENTS,
    } <= kinds


def test_fixture_preserves_hostile_names_byte_for_byte(fixture_path):
    payload = json.loads(fixture_path.read_text(encoding="utf-8"))
    result = _build(payload)
    # Regression guard: the old pipeline mangled quotes, "]]", "[[" and commas.
    assert result.nodes["90"]["name"] == 'Hostile "Name" ]] [[ , Gödelian'
    assert result.nodes["93"]["name"] == "Gödelian Arguments"
    assert result.nodes["93"]["nameRaw"] == "GÃ¶delian Arguments"
