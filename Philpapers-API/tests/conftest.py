from pathlib import Path

import pytest


@pytest.fixture
def make_record():
    """Build a payload record in the documented [name, id, parents, primary] shape."""

    def _make(name, category_id, parents="", primary=""):
        return [name, category_id, parents, primary]

    return _make


@pytest.fixture
def fixture_path():
    return Path(__file__).parent / "fixtures" / "taxonomy_sample.json"


@pytest.fixture(scope="module")
def repo_root():
    return Path(__file__).resolve().parent.parent
