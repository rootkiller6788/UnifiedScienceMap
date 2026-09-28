"""Cross-listings as a chord diagram, one chord per category.

The radial map draws the *generating tree*: every category hangs under a single
parent, so the map shows how the taxonomy is organised but not how its branches
interpenetrate. This module throws the interior away and keeps only the DAG
edges that cross between branches.

**The unit of a chord is one category.** When a category is filed under more
than one parent, it is drawn once for each parent beyond its primary one: a
ribbon runs from the branch holding its primary parent to the branch holding
that extra parent. So the ring answers "which sub-disciplines actually exchange
categories", and each ribbon can name the specific category it stands for.

Grouping by *branch* rather than by top-level domain is the point. Of the 1,035
cross-branch chords, **441 (43%) join two branches inside the same top-level
domain**. A domain-level chord diagram cannot draw any of them: the edge never
leaves the domain, so at that resolution it is not an edge at all. The largest is
``Applied Ethics <-> Social and Political Philosophy`` (39), both under Value
Theory, and it is the third largest pair in the whole taxonomy.

Everything is keyed to the depth-2 nodes of the tree: the seven top-level
domains supply the colour, the depth-2 branches supply the arcs.

Pure module: no I/O, no globals, no randomness.
"""

from __future__ import annotations

from typing import Any

# The validated dark-mode categorical order, shared with the radial map so a
# domain keeps its colour across views. Validated against a #000000 surface:
# lightness band, chroma floor, adjacent-pair CVD, normal-vision floor and
# contrast all pass. The order is load-bearing -- #199e70 and #008300 are both
# greens and only pass because they are not adjacent in this sequence.
SERIES = ("#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9")


def build_chord(nested: list[dict], *, palette: tuple[str, ...] = SERIES,
                examples: int = 5) -> dict[str, Any]:
    """Turn the nested taxonomy into a branch-level chord dataset."""
    if not nested:
        return _empty(palette)
    root = nested[0]
    domains = root.get("children") or []
    if not domains:
        return _empty(palette)

    branch_of: dict[str, int] = {}     # category id -> branch index
    branches: list[dict[str, Any]] = []
    total = 0
    cross_listed = 0
    parent_pairs = 0

    def walk(node: dict, b: int) -> None:
        cid = str(node.get("id", ""))
        if cid:
            branch_of[cid] = b
        branches[b]["nodes"] += 1
        for kid in node.get("children") or ():
            walk(kid, b)

    for top in domains:
        for child in top.get("children") or ():
            branches.append({
                "id": str(child.get("id", "")),
                "name": child.get("name", ""),
                "domain": 0,           # filled in by the pass below
                "nodes": 0,
                "degree": 0,
                "loops": 0,
            })
            walk(child, len(branches) - 1)

    # A second pass assigns each branch its domain, so the ordering above can
    # stay a plain pre-order walk.
    d = 0
    cursor = 0
    for top in domains:
        for _ in top.get("children") or ():
            branches[cursor]["domain"] = d
            cursor += 1
        d += 1

    chords: list[dict[str, Any]] = []
    loops: list[dict[str, Any]] = []
    loop_index: dict[int, int] = {}
    beyond = 0                 # extra parent sits above depth 2 (the root or a domain)

    # Depth is not carried in the nested tree, so it is measured here as we walk.
    stack: list[tuple[dict, int]] = [(root, 0)]
    while stack:
        node, depth = stack.pop()
        parents = [str(p) for p in (node.get("parentIds") or ())]
        if len(parents) > 1:
            cross_listed += 1
            parent_pairs += len(parents) - 1
            primary = str(node.get("primaryParentId", ""))
            home = branch_of.get(primary)
            if home is None:
                # The primary parent IS the root or a domain; its children are
                # the branches, so there is no branch to anchor this to.
                home = branch_of.get(str(node.get("id", "")))
            name = node.get("name", "")
            for p in parents:
                if p == primary:
                    continue
                other = branch_of.get(p)
                if home is None or other is None:
                    beyond += 1
                    continue
                if other == home:
                    # Both parents inside one branch: no ribbon is possible, and
                    # 581 inward feathers would be noise. Aggregated per branch.
                    slot = loop_index.get(home)
                    if slot is None:
                        loop_index[home] = len(loops)
                        loops.append({"b": home, "count": 0, "examples": []})
                        slot = loop_index[home]
                    loops[slot]["count"] += 1
                    branches[home]["loops"] += 1
                    branches[home]["degree"] += 1
                    loops[slot]["examples"].append([name, depth])
                    continue
                chords.append({"s": home, "t": other, "name": name, "depth": depth})
                branches[home]["degree"] += 1
                branches[other]["degree"] += 1
        total += 1
        for kid in node.get("children") or ():
            stack.append((kid, depth + 1))

    # Ordering the chords by partner keeps every bundle that shares a partner
    # contiguous along the arc, which is what makes the pattern legible.
    chords.sort(key=lambda c: (c["s"], c["t"], c["name"], c["depth"]))

    for loop in loops:
        loop["examples"] = sorted(_dedupe(loop["examples"]),
                                  key=lambda e: (e[1], len(e[0]), e[0]))[:examples]

    used = sum(1 for b in branches if b["degree"] > 0)

    return {
        "meta": {
            "categories": total,
            "crossListed": cross_listed,
            "chords": len(chords),
            "loops": sum(l["count"] for l in loops),
            "beyond": beyond,
            "parentPairs": parent_pairs,
            "branches": used,
            "branchesTotal": len(branches),
            "distinctPairs": len({(min(c["s"], c["t"]), max(c["s"], c["t"]))
                                  for c in chords}),
        },
        "palette": list(palette),
        "domains": [{"id": str(t.get("id", "")), "name": t.get("name", "")}
                    for t in domains],
        "branches": branches,
        "chords": chords,
        "loops": loops,
    }


def _dedupe(pairs: list[list[Any]]) -> list[list[Any]]:
    out: list[list[Any]] = []
    seen: set[str] = set()
    for name, depth in pairs:
        if name in seen:
            continue
        seen.add(name)
        out.append([name, depth])
    return out


def _empty(palette: tuple[str, ...]) -> dict[str, Any]:
    return {
        "meta": {"categories": 0, "crossListed": 0, "chords": 0, "loops": 0,
                 "beyond": 0, "parentPairs": 0, "branches": 0, "branchesTotal": 0,
                 "distinctPairs": 0},
        "palette": list(palette),
        "domains": [],
        "branches": [],
        "chords": [],
        "loops": [],
    }
