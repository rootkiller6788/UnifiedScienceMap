"""Tests for the self-contained HTML map.

The page has to survive hostile category names (the fixture contains
``Hostile "Name" ]] [[ , Gödelian``) and it has to stay genuinely self-contained,
so those two things are asserted here rather than eyeballed in a browser.
"""

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))
import render_map  # noqa: E402

HOSTILE = 'Hostile "Name" ]] [[ , Gödelian </script><!-- & <b>'


@pytest.fixture
def nested():
    return [{
        "id": "1", "name": "All Philosophy", "parentIds": [], "synthetic": True,
        "children": [
            {"id": "10", "name": HOSTILE, "parentIds": ["1"], "children": [
                {"id": "11", "name": "Leaf   one", "parentIds": ["10", "20"], "children": []},
            ]},
            {"id": "20", "name": "B", "parentIds": ["1"], "children": []},
        ],
    }]


# --------------------------------------------------------------------------
# inline_json
# --------------------------------------------------------------------------

def test_inline_json_escapes_script_breakers():
    out = render_map.inline_json({"n": "</script><!--"})
    assert "<" not in out and ">" not in out
    assert "\\u003c" in out and "\\u003e" in out


def test_inline_json_escapes_line_separators():
    out = render_map.inline_json({"n": "a b c"})
    assert " " not in out and " " not in out
    assert "\\u2028" in out and "\\u2029" in out


def test_inline_json_escapes_ampersand():
    assert "&" not in render_map.inline_json({"n": "x & y"})


def test_inline_json_round_trips_through_json():
    payload = {"n": HOSTILE, "sep": "a b", "q": 'he said "hi" \\ bye'}
    assert json.loads(render_map.inline_json(payload)) == payload


# --------------------------------------------------------------------------
# The page
# --------------------------------------------------------------------------

def test_page_has_no_external_requests(nested):
    html = render_map.render_map(nested, stats={}, source="x.json")
    # No src=, href=, @import, url( or fetch( pointing anywhere.
    assert not re.search(r'\bsrc\s*=', html)
    assert not re.search(r'\bhref\s*=', html)
    assert "@import" not in html
    assert "fetch(" not in html
    assert "http://" not in html and "https://" not in html


def test_page_script_block_survives_a_hostile_name(nested):
    html = render_map.render_map(nested, stats={}, source="x.json")
    # Exactly one data block and one script block, both closed properly.
    assert html.count('<script type="application/json"') == 1
    assert html.count("<script>") == 1
    assert html.count("</script>") == 2


def test_embedded_data_reparses_to_the_same_tree(nested):
    html = render_map.render_map(nested, stats={}, source="x.json")
    raw = html.split('<script type="application/json" id="layout">', 1)[1]
    raw = raw.split("</script>", 1)[0]
    layout = json.loads(raw)
    assert layout["names"] == ["All Philosophy", HOSTILE, "Leaf   one", "B"]
    assert layout["ids"] == ["1", "10", "11", "20"]
    assert layout["crossParents"] == [[], [], ["20"], []]
    assert layout["totalLeaves"] == 2
    assert len(layout["clusters"]) == 2


def test_page_embeds_all_seven_series_slots(nested):
    html = render_map.render_map(nested, stats={}, source="x.json")
    for slot in range(1, 8):
        assert html.count(f"--series-{slot}:") == 3   # light, media-dark, data-theme-dark
    for hexcode in render_map.LIGHT_SERIES + render_map.DARK_SERIES:
        assert hexcode in html


def test_data_is_never_written_through_innerhtml(nested):
    html = render_map.render_map(nested, stats={}, source="x.json")
    # innerHTML only ever takes static markup or a pre-built variable -- never a
    # concatenation, which is how a category name could become live markup.
    assigns = re.findall(r"innerHTML\s*=\s*([^;]{0,40});", html)
    assert assigns, "expected some innerHTML use"
    for rhs in assigns:
        assert re.fullmatch(r'([A-Za-z_$][\w$]*|"")', rhs.strip()), rhs
    assert "textContent" in html


def test_meta_counts_cross_listings(nested):
    html = render_map.render_map(nested, stats={}, source="/some/dir/x.json")
    meta = html.split('<div class="meta">', 1)[1].split("</div>", 1)[0]
    assert "4 categories" in meta
    assert "1 cross-listed" in meta
    assert "2 top-level domains" in meta
    assert "/some/dir" not in meta          # only the basename is shown
    assert "x.json" in meta


def test_title_is_html_escaped(nested):
    html = render_map.render_map(nested, stats={}, source="", title="A & B <c>")
    assert "<title>A &amp; B &lt;c&gt;</title>" in html


# --------------------------------------------------------------------------
# The page's JavaScript, run for real
# --------------------------------------------------------------------------

@pytest.fixture(scope="module")
def real_map(repo_root):
    path = repo_root / "output" / "map.html"
    if not path.exists():
        pytest.skip("run the pipeline first to produce output/map.html")
    return path


def test_map_script_runs_and_draws(real_map):
    """Execute the page's script against a stub DOM.

    A typo in ~500 lines of JS yields a blank canvas, not an error, so the
    script is actually run and its canvas calls inspected: no throw, no NaN
    coordinates, every domain drawn.
    """
    if shutil.which("node") is None:
        pytest.skip("node is not installed")
    harness = Path(__file__).parent / "check_map_js.mjs"
    proc = subprocess.run(
        ["node", str(harness), str(real_map)],
        capture_output=True, text=True, timeout=120,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert proc.stdout.startswith("ok")
