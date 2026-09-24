"""``app/graph_integrity.py`` (task 0.4), beyond the shared fixtures.

The shared ``integrityCases`` in ``contracts/fixtures/index.json`` prove the
two languages agree (test_contracts.py). These tests pin down the rules that
have no fixture of their own, and the behaviour around them: cycles reported
once, the depth limit's exact boundary, deterministic ordering, v1 documents
getting only the id/edge rules, and bounded error messages.
"""

from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from app.graph_integrity import RULE_CODES, GraphIntegrityError, assert_integrity, check_integrity

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "contracts" / "fixtures"
HYBRID = json.loads((FIXTURES_DIR / "archgraph.v2-hybrid-orders.valid.json").read_text(encoding="utf-8"))


def node(nid, role="service", parent=None, code=None, **extra):
    n = {"id": nid, "type": role, "label": nid, "codeName": code or nid, "position": {"x": 0, "y": 0}}
    if parent:
        n["parentId"] = parent
    n.update(extra)
    return n


def doc(nodes, edges=(), **extra):
    return {"schemaVersion": "2.0", "settings": {"codeName": "t", "environment": "dev"},
            "nodes": list(nodes), "edges": list(edges), **extra}


def codes(document):
    return [issue.code for issue in check_integrity(document)]


def test_the_rich_fixture_is_clean():
    assert check_integrity(HYBRID) == []


def test_every_rule_code_is_unique_and_prefixed():
    assert len(RULE_CODES) == len(set(RULE_CODES)) == 19
    assert all(code.startswith("INT-") for code in RULE_CODES)


# ------------------------------------------------------------------ containment


def test_a_self_parent_is_a_cycle_reported_once():
    issues = check_integrity(doc([node("a", "network_segment", parent="a")]))
    assert [(i.code, i.path, i.message) for i in issues] == [
        ("INT-PARENT-CYCLE", "nodes[0].parentId", "containment loop a -> a")
    ]


def test_a_cycle_is_reported_once_anchored_at_its_first_member_whatever_the_order():
    ring = [node("b", "zone", parent="c"), node("a", "network_segment", parent="b"), node("c", "zone", parent="a")]
    for rotation in range(3):
        nodes = ring[rotation:] + ring[:rotation]
        issues = check_integrity(doc(nodes))
        assert [i.code for i in issues] == ["INT-PARENT-CYCLE"]
        first = nodes[0]["id"]
        assert issues[0].path == "nodes[0].parentId"
        assert issues[0].message.startswith(f"containment loop {first} -> ")
        assert issues[0].message.endswith(f" -> {first}")


def test_nodes_hanging_below_a_cycle_do_not_get_a_depth_error_too():
    nodes = [node("a", "zone", parent="b"), node("b", "zone", parent="a")]
    nodes += [node(f"x{i}", "network_segment", parent=("a" if i == 0 else f"x{i - 1}")) for i in range(8)]
    assert codes(doc(nodes)) == ["INT-PARENT-CYCLE"]


def chain(levels):
    nodes = [node("l1", "site")]
    for level in range(2, levels + 1):
        nodes.append(node(f"l{level}", "network_segment", parent=f"l{level - 1}"))
    return nodes


def test_depth_six_is_allowed_and_seven_is_reported_once_at_the_first_offending_level():
    assert check_integrity(doc(chain(6))) == []
    issues = check_integrity(doc(chain(9)))
    assert [(i.code, i.path) for i in issues] == [("INT-DEPTH", "nodes[6].parentId")]
    assert "nested 7 levels deep; the limit is 6" in issues[0].message


def test_a_dangling_parent_is_reported_and_its_subtree_still_measured_from_there():
    nodes = [node("a", "network_segment", parent="ghost"), node("b", "service", parent="a")]
    assert codes(doc(nodes)) == ["INT-DANGLING-PARENT"]


# ------------------------------------------------------------------ catalogue membership


def test_a_variant_on_a_role_without_variants_is_unknown():
    issues = check_integrity(doc([node("db", "relational_db", variant="relational")]))
    assert [i.code for i in issues] == ["INT-UNKNOWN-VARIANT"]
    assert "(allowed: none)" in issues[0].message


def test_an_unknown_role_is_not_also_checked_for_variants():
    assert codes(doc([node("q", "quantum_router", variant="x")])) == ["INT-UNKNOWN-ROLE"]


@pytest.mark.parametrize(
    ("legacy", "hint"),
    [("object_store", "'object_storage'"), ("subnet", "'network_segment (variant subnet)'"), ("kubernetes_cluster", "'container_platform'")],
)
def test_legacy_and_design_v02_ids_are_refused_with_the_canonical_id(legacy, hint):
    issues = check_integrity(doc([node("n", legacy)]))
    assert [i.code for i in issues] == ["INT-UNKNOWN-ROLE"]
    assert f"use {hint}" in issues[0].message


# ------------------------------------------------------------------ deployment


def deployment(**extra):
    base = {
        "profiles": [{"id": "dc1", "target": "vsphere", "label": "DC1"}, {"id": "aws_sg", "target": "aws", "label": "AWS"}],
        "scenarios": [{"id": "s1", "label": "One", "defaultProfileId": "dc1"}],
    }
    base.update(extra)
    return base


def test_duplicate_profile_and_scenario_ids():
    d = deployment()
    d["profiles"].append({"id": "dc1", "target": "bare_metal", "label": "Again"})
    d["scenarios"].append({"id": "s1", "label": "Again", "defaultProfileId": "aws_sg"})
    assert codes(doc([node("a")], deployment=d)) == ["INT-DUPLICATE-PROFILE-ID", "INT-DUPLICATE-SCENARIO-ID"]


def test_unknown_active_scenario():
    assert codes(doc([node("a")], deployment=deployment(activeScenarioId="s9"))) == ["INT-UNKNOWN-SCENARIO"]


def test_a_placement_to_an_unknown_profile_and_a_node_placed_twice():
    d = deployment(scenarios=[{"id": "s1", "label": "Hybrid", "defaultProfileId": "dc1",
                               "placements": [{"nodeId": "a", "profileId": "aws_sg"}, {"nodeId": "a", "profileId": "gcp_x"}]}])
    assert codes(doc([node("a")], deployment=d)) == ["INT-UNKNOWN-PROFILE", "INT-DUPLICATE-PLACEMENT"]


def test_one_node_may_have_bindings_for_several_targets():
    d = deployment(bindings=[{"nodeId": "a", "target": "aws", "realisation": "aws.ecs_fargate"},
                             {"nodeId": "a", "target": "vsphere", "realisation": "vsphere.vm_group"}])
    assert check_integrity(doc([node("a")], deployment=d)) == []


# ------------------------------------------------------------------ decisions


def test_duplicate_decision_ids_and_a_dangling_supersedes():
    decisions = [
        {"id": "adr1", "number": 1, "title": "One", "status": "superseded"},
        {"id": "adr1", "number": 2, "title": "Two", "status": "accepted", "supersedes": "adr0"},
    ]
    issues = check_integrity(doc([node("a")], decisions=decisions))
    assert [(i.code, i.path) for i in issues] == [
        ("INT-DUPLICATE-DECISION-ID", "decisions[1].id"),
        ("INT-DANGLING-DECISION-REF", "decisions[1].supersedes"),
    ]


# ------------------------------------------------------------------ versions, order, messages


def test_a_v1_document_gets_only_the_id_and_edge_rules():
    v1 = {"schemaVersion": "1.0",
          "nodes": [{"id": "n1", "type": "external_api", "label": "x", "position": {"x": 0, "y": 0}}],
          "edges": []}
    assert check_integrity(v1) == [], "external_api is a legal 1.0 type; the catalogue applies to 2.0 only"


def test_issues_come_in_a_stable_document_order():
    broken = copy.deepcopy(HYBRID)
    broken["nodes"][3]["parentId"] = "ghost"
    broken["edges"][1]["source"] = "gone"
    broken["deployment"]["bindings"][0]["nodeId"] = "gone"
    first = [(i.code, i.path) for i in check_integrity(broken)]
    assert first == [
        ("INT-DANGLING-EDGE", "edges[1].source"),
        ("INT-DANGLING-PARENT", "nodes[3].parentId"),
        ("INT-DANGLING-BINDING", "deployment.bindings[0].nodeId"),
    ]
    assert [(i.code, i.path) for i in check_integrity(copy.deepcopy(broken))] == first


def test_user_values_in_messages_are_truncated():
    long_id = "x" * 64
    issues = check_integrity(doc([node("a")], [{"id": "e", "source": "a", "target": long_id, "label": "",
                                               "direction": "forward", "kind": "flow"}]))
    assert len(issues[0].message) < 100
    assert "..." in issues[0].message


def test_assert_integrity_raises_a_value_error_with_a_summary():
    with pytest.raises(GraphIntegrityError) as caught:
        assert_integrity(doc([node("a"), node("a")]))
    assert isinstance(caught.value, ValueError), "pydantic must turn it into a 422"
    assert str(caught.value) == (
        "graph failed integrity checks - INT-DUPLICATE-NODE-ID nodes[1].id: 'a' is used by another node; "
        "INT-DUPLICATE-CODENAME nodes[1].codeName: 'a' is used by another node"
    )
