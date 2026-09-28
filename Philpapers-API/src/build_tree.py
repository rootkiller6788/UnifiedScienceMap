"""Turn PhilPapers taxonomy records into a navigable tree, with diagnostics.

Pure module: no disk I/O, no network, no globals, no ``os.chdir``. Every
function is deterministic, so identical input always yields identical output.

The input is the PhilPapers ``categories.json`` payload:

    [["Philosophy, Misc", 4, "1", 1], ...]

Each record is a 4-element *array* (not an object) of
``[name: str, id: int, parents: str, primaryParent: int]``. Note that field 2
is a **comma-separated string** of parent IDs, not a JSON array.

The taxonomy is a DAG, not a tree: ~21% of categories have more than one
parent. Every record therefore carries two edge sets -- ``parents`` (all DAG
edges) and ``primary_parent`` (the spanning tree used for navigation). We keep
both, so the output is lossless: you walk ``children`` to navigate, and
``parentIds`` is still there if you need the cross-links.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Sequence

# The taxonomy's real root. It is referenced by every top-level category but
# has no record of its own in the payload, so we synthesize it.
ROOT_ID = "1"
ROOT_NAME = "All Philosophy"

# Problem kinds, emitted into the report.
SYNTHETIC_ROOT = "SYNTHETIC_ROOT"
DUPLICATE_ID = "DUPLICATE_ID"
BAD_RECORD = "BAD_RECORD"
SELF_PARENT = "SELF_PARENT"
DANGLING_PARENT = "DANGLING_PARENT"
CYCLE = "CYCLE"
MULTIPLE_ROOTS = "MULTIPLE_ROOTS"
EMPTY_NAME = "EMPTY_NAME"
PRIMARY_NOT_IN_PARENTS = "PRIMARY_NOT_IN_PARENTS"
MOJIBAKE_REPAIRED = "MOJIBAKE_REPAIRED"
SHAPE_NOTE = "SHAPE_NOTE"


# --------------------------------------------------------------------------
# Encoding repair
# --------------------------------------------------------------------------

def _cp1252_inverse() -> dict[str, int]:
    """Invert the CP1252 decode table: character -> original byte.

    CP1252 leaves 0x81, 0x8D, 0x8F, 0x90 and 0x9D undefined. Python decodes
    those to U+0081..U+009D but refuses to encode them back, which is why the
    obvious ``s.encode('cp1252')`` fails on some names. Mapping them straight
    through as ``chr(byte)`` makes the round-trip total.
    """
    inverse: dict[str, int] = {}
    for byte in range(256):
        try:
            char = bytes([byte]).decode("cp1252")
        except UnicodeDecodeError:
            char = chr(byte)
        inverse.setdefault(char, byte)
    return inverse


_CP1252_INVERSE = _cp1252_inverse()


def repair_encoding(name: str) -> tuple[str, bool]:
    """Undo CP1252 mojibake, e.g. ``GÃ¶delian`` -> ``Gödelian``.

    Returns ``(name, repaired)``. ASCII names and names that are already
    correct UTF-8 come back untouched, so this is safe to apply blindly.
    """
    if name.isascii():
        return name, False
    try:
        candidate = bytes(_CP1252_INVERSE[ch] for ch in name).decode("utf-8")
    except (KeyError, UnicodeDecodeError):
        return name, False
    # Guard against a repair that would damage a genuinely non-ASCII name.
    if candidate.count("�") or not candidate:
        return name, False
    return candidate, candidate != name


# --------------------------------------------------------------------------
# Normalization
# --------------------------------------------------------------------------

def normalize_id(value: Any) -> str | None:
    """Coerce an ID to a canonical string, tolerating int/padded-string noise."""
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        stripped = value.strip()
        return stripped or None
    return None


def normalize_ids(value: Any) -> tuple[str, ...]:
    """Coerce a parent field to a tuple of IDs.

    The real payload uses a comma-separated string (``"492730,5986,16"``), but
    we also accept a bare int, a scalar string, or a list -- so that an
    unexpected shape yields a usable tree plus a diagnostic rather than a
    crash.
    """
    if value is None:
        return ()
    if isinstance(value, bool):
        return ()
    if isinstance(value, int):
        return (str(value),)
    if isinstance(value, str):
        return tuple(part.strip() for part in value.split(",") if part.strip())
    if isinstance(value, (list, tuple)):
        out: list[str] = []
        for item in value:
            if isinstance(item, str) and "," in item:
                out.extend(p.strip() for p in item.split(",") if p.strip())
            else:
                normalized = normalize_id(item)
                if normalized is not None:
                    out.append(normalized)
        return tuple(out)
    return ()


def id_sort_key(category_id: str) -> tuple[int, int, str]:
    """Sort key that orders numeric IDs numerically, others lexicographically."""
    try:
        return (0, int(category_id), "")
    except (TypeError, ValueError):
        return (1, 0, category_id)


# --------------------------------------------------------------------------
# Records
# --------------------------------------------------------------------------

@dataclass(frozen=True, slots=True)
class Category:
    id: str
    name: str
    parent_ids: tuple[str, ...]
    primary_parent_id: str | None
    source_index: int
    name_raw: str | None = None


@dataclass(frozen=True, slots=True)
class Problem:
    kind: str
    ids: tuple[str, ...]
    detail: str


@dataclass
class BuildResult:
    roots: list[str]
    nodes: dict[str, dict]
    flat: dict[str, dict]
    problems: list[Problem] = field(default_factory=list)
    stats: dict = field(default_factory=dict)


def parse_records(raw: Any) -> tuple[list[Category], list[Problem]]:
    """Parse the raw payload into ``Category`` records plus shape diagnostics."""
    problems: list[Problem] = []
    if not isinstance(raw, list):
        problems.append(
            Problem(SHAPE_NOTE, (), f"expected a top-level JSON array, got {type(raw).__name__}")
        )
        return [], problems

    records: list[Category] = []
    seen_shapes: set[tuple[str, ...]] = set()

    for index, entry in enumerate(raw):
        if not isinstance(entry, (list, tuple)):
            problems.append(
                Problem(BAD_RECORD, (), f"record {index}: expected array, got {type(entry).__name__}")
            )
            continue
        if len(entry) != 4:
            problems.append(
                Problem(BAD_RECORD, (), f"record {index}: expected 4 fields, got {len(entry)}")
            )
            continue

        name_value, id_value, parents_value, primary_value = entry
        shape = tuple(type(v).__name__ for v in entry)
        seen_shapes.add(shape)

        category_id = normalize_id(id_value)
        if category_id is None:
            problems.append(
                Problem(BAD_RECORD, (), f"record {index}: unusable id {id_value!r}")
            )
            continue

        name = name_value if isinstance(name_value, str) else str(name_value)
        name_raw: str | None = None
        if not name.strip():
            problems.append(Problem(EMPTY_NAME, (category_id,), "empty category name"))
            name = f"(untitled {category_id})"
        else:
            repaired, changed = repair_encoding(name)
            if changed:
                name_raw = name
                name = repaired
                problems.append(
                    Problem(MOJIBAKE_REPAIRED, (category_id,), f"repaired name: {repaired!r}")
                )

        records.append(
            Category(
                id=category_id,
                name=name,
                parent_ids=normalize_ids(parents_value),
                primary_parent_id=normalize_id(primary_value),
                source_index=index,
                name_raw=name_raw,
            )
        )

    expected = {("str", "int", "str", "int")}
    if seen_shapes - expected:
        unexpected = sorted(seen_shapes - expected)
        problems.append(
            Problem(
                SHAPE_NOTE,
                (),
                f"record field types differ from the documented "
                f"(str,int,str,int): {unexpected}",
            )
        )

    return records, problems


# --------------------------------------------------------------------------
# Construction
# --------------------------------------------------------------------------

def build_forest(
    records: Sequence[Category],
    *,
    prior_problems: Sequence[Problem] = (),
) -> BuildResult:
    """Build the tree. Pure: records in, result out.

    ``prior_problems`` carries diagnostics produced upstream (by
    :func:`parse_records`) so that a single report describes the whole run.
    """
    problems: list[Problem] = list(prior_problems)

    # --- index, first occurrence wins -------------------------------------
    index: dict[str, Category] = {}
    for record in records:
        existing = index.get(record.id)
        if existing is not None:
            problems.append(
                Problem(
                    DUPLICATE_ID,
                    (record.id,),
                    f"id {record.id} appears at records {existing.source_index} "
                    f"({existing.name!r}) and {record.source_index} ({record.name!r}); "
                    f"keeping the first",
                )
            )
            continue
        index[record.id] = record

    # --- resolve the primary-parent edge for every node --------------------
    # parent[id] is the id this node hangs from, or None when it is a root.
    parent: dict[str, str | None] = {}
    dangling: list[str] = []

    for category_id, record in index.items():
        candidate = record.primary_parent_id
        if candidate is None or candidate == category_id:
            if candidate == category_id:
                problems.append(
                    Problem(SELF_PARENT, (category_id,), "category is its own primary parent")
                )
            parent[category_id] = None
            continue
        if candidate not in index and candidate != ROOT_ID:
            problems.append(
                Problem(
                    DANGLING_PARENT,
                    (category_id,),
                    f"primary parent {candidate} has no record; promoting to root",
                )
            )
            dangling.append(category_id)
            parent[category_id] = None
            continue
        if candidate not in record.parent_ids:
            problems.append(
                Problem(
                    PRIMARY_NOT_IN_PARENTS,
                    (category_id,),
                    f"primary parent {candidate} is absent from parents {list(record.parent_ids)}",
                )
            )
        parent[category_id] = candidate

    # --- synthesize the root if the payload refers to it but omits it ------
    root_is_synthetic = ROOT_ID not in index
    if root_is_synthetic:
        refers_to_root = any(p == ROOT_ID for p in parent.values())
        if refers_to_root:
            index[ROOT_ID] = Category(
                id=ROOT_ID,
                name=ROOT_NAME,
                parent_ids=(),
                primary_parent_id=None,
                source_index=-1,
            )
            parent[ROOT_ID] = None
            problems.append(
                Problem(
                    SYNTHETIC_ROOT,
                    (ROOT_ID,),
                    f"root id {ROOT_ID} is referenced but has no record; "
                    f"synthesized as {ROOT_NAME!r}",
                )
            )

    # --- break cycles ------------------------------------------------------
    # Three-colour DFS over primary-parent edges. Each cycle is cut at its
    # smallest ID so the same malformed input always produces the same tree.
    WHITE, GREY, BLACK = 0, 1, 2
    colour = {category_id: WHITE for category_id in index}
    cut: set[str] = set()

    for start in index:
        if colour[start] != WHITE:
            continue
        path: list[str] = []
        node: str | None = start
        while node is not None and colour.get(node) == WHITE:
            colour[node] = GREY
            path.append(node)
            node = parent.get(node)
        if node is not None and colour.get(node) == GREY and node in path:
            cycle = path[path.index(node):]
            victim = min(cycle, key=id_sort_key)
            parent[victim] = None
            cut.add(victim)
            problems.append(
                Problem(
                    CYCLE,
                    tuple(cycle),
                    f"cycle {cycle} broken at {victim} (smallest id)",
                )
            )
        for visited in path:
            colour[visited] = BLACK

    # --- assemble children -------------------------------------------------
    children: dict[str, list[str]] = {category_id: [] for category_id in index}
    for category_id, parent_id in parent.items():
        if parent_id is not None and parent_id in children:
            children[parent_id].append(category_id)

    def sort_children(ids: list[str]) -> list[str]:
        return sorted(ids, key=lambda i: (index[i].name.casefold(), id_sort_key(i)))

    for category_id in children:
        children[category_id] = sort_children(children[category_id])

    roots = sort_children([c for c, p in parent.items() if p is None])

    # --- depths and paths via BFS from the roots ---------------------------
    depth: dict[str, int] = {}
    path_of: dict[str, str] = {}
    queue: list[str] = []
    for root in roots:
        depth[root] = 0
        path_of[root] = index[root].name
        queue.append(root)

    cursor = 0
    while cursor < len(queue):
        current = queue[cursor]
        cursor += 1
        for child in children[current]:
            if child in depth:  # defensive: residual cycle
                continue
            depth[child] = depth[current] + 1
            path_of[child] = f"{path_of[current]} > {index[child].name}"
            queue.append(child)

    # --- problems that depend on the final shape ---------------------------
    if len(roots) > 1:
        problems.append(
            Problem(
                MULTIPLE_ROOTS,
                tuple(roots),
                f"{len(roots)} roots: {[index[r].name for r in roots]}",
            )
        )

    unreachable = sorted((c for c in index if c not in depth), key=id_sort_key)
    if unreachable:
        problems.append(
            Problem(
                MULTIPLE_ROOTS,
                tuple(unreachable),
                f"{len(unreachable)} nodes unreachable from any root",
            )
        )

    # --- outputs -----------------------------------------------------------
    nodes: dict[str, dict] = {}
    flat: dict[str, dict] = {}
    for category_id, record in index.items():
        nodes[category_id] = {
            "name": record.name,
            "parentIds": list(record.parent_ids),
            "primaryParentId": record.primary_parent_id,
            "children": children[category_id],
            "synthetic": category_id == ROOT_ID and root_is_synthetic,
            "nameRaw": record.name_raw,
        }
        if category_id in depth:
            flat[category_id] = {
                "name": record.name,
                "parentIds": list(record.parent_ids),
                "primaryParentId": record.primary_parent_id,
                "depth": depth[category_id],
                "path": path_of[category_id],
                "childCount": len(children[category_id]),
            }

    multi_parent = sum(1 for r in index.values() if len(r.parent_ids) > 1)
    stats = {
        "records": len(records),
        "nodes": len(index),
        "roots": len(roots),
        "maxDepth": max(depth.values(), default=0),
        "multiParent": multi_parent,
        "reachable": len(depth),
        "cyclesBroken": len(cut),
        "danglingPromoted": len(dangling),
    }

    return BuildResult(roots=roots, nodes=nodes, flat=flat, problems=problems, stats=stats)


# --------------------------------------------------------------------------
# Projections
# --------------------------------------------------------------------------

def to_nested(result: BuildResult) -> list[dict]:
    """Nested tree: an array of root nodes, each with recursive ``children``."""
    def build(category_id: str) -> dict:
        node = result.nodes[category_id]
        out: dict[str, Any] = {
            "id": category_id,
            "name": node["name"],
            "parentIds": node["parentIds"],
            "children": [build(child) for child in node["children"]],
        }
        if node["primaryParentId"] is not None:
            out["primaryParentId"] = node["primaryParentId"]
        if node["synthetic"]:
            out["synthetic"] = True
        if node["nameRaw"] is not None:
            out["nameRaw"] = node["nameRaw"]
        return out

    return [build(root) for root in result.roots]


def to_flat(result: BuildResult) -> dict[str, dict]:
    """Flat lookup table keyed by category ID, carrying depth and full path."""
    return dict(sorted(result.flat.items(), key=lambda kv: id_sort_key(kv[0])))


def build_report(
    result: BuildResult,
    *,
    source: str,
    record_count: int,
) -> dict:
    """Diagnostics document: stats, problems grouped by kind, provenance."""
    grouped: dict[str, list[dict]] = {}
    for problem in result.problems:
        grouped.setdefault(problem.kind, []).append(
            {"ids": list(problem.ids), "detail": problem.detail}
        )
    return {
        "source": source,
        "recordCount": record_count,
        "stats": result.stats,
        "problemCounts": {kind: len(items) for kind, items in sorted(grouped.items())},
        "problems": grouped,
    }
