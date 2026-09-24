"""The component catalogue (task 0.6) - the Python half.

``contracts/catalog/components.json`` is shared data (design-v2 D-03). This file
and ``src/domain/graph/catalog.test.ts`` assert the same things about it:

1. it matches ``components.schema.json``;
2. its cross-references hold (layers, NEST rules, aliases, legacy types, access
   modes) - JSON Schema cannot say "points at a role that exists";
3. it agrees with the wire contract (attribute enums, edge modes, legacy 1.0
   types) so the two files cannot drift;
4. it covers requirements v2.1 section 4.1.1 (Must and Should roles, on-prem gear)
   with the v2.1 role ids (red-team review B1);
5. it is provider-neutral (NFR2-NEUT-001): no token from neutrality-tokens.json
   anywhere in it, nor in the contract's property names and enum values, nor in
   a valid 2.0 fixture outside its `deployment` subtree (review B2).
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator

CONTRACTS_DIR = Path(__file__).resolve().parents[2] / "contracts"
CATALOG_DIR = CONTRACTS_DIR / "catalog"
CATALOG = json.loads((CATALOG_DIR / "components.json").read_text(encoding="utf-8"))
SCHEMA = json.loads((CATALOG_DIR / "components.schema.json").read_text(encoding="utf-8"))
TOKENS = json.loads((CATALOG_DIR / "neutrality-tokens.json").read_text(encoding="utf-8"))["tokens"]
CONTRACT = json.loads((CONTRACTS_DIR / "archgraph.schema.json").read_text(encoding="utf-8"))
MANIFEST = json.loads((CONTRACTS_DIR / "fixtures" / "index.json").read_text(encoding="utf-8"))

ROLES = {role["id"]: role for role in CATALOG["roles"]}
LAYERS = {layer["id"] for layer in CATALOG["layers"]}
CONTAINERS = {role_id for role_id, role in ROLES.items() if role["container"]}
EDGE_MODES = {mode["id"] for mode in CATALOG["edgeModes"]}

# requirements-v2.md v2.1 section 4.1.1, Must and Should rows, v2.1 ids.
V21_MUST = {
    "dns", "cdn", "api_gateway", "load_balancer", "firewall", "site", "zone", "network_segment",
    "virtual_machine", "container_platform", "bare_metal_host", "hypervisor_cluster", "service",
    "relational_db", "key_value_store", "cache", "object_storage", "block_storage", "file_storage", "san",
    "backup_target", "queue", "identity_provider", "secrets_vault", "client", "external_service", "note",
    "shape", "text",
}
V21_SHOULD = {
    "waf", "reverse_proxy", "ddos_protection", "router", "switch", "vpn_link", "function", "document_db",
    "search_index", "pubsub_topic", "event_stream", "key_management", "siem_log_store",
    "certificate_authority", "monitoring",
}
# Needed by the Must wizard rule "air-gap -> local artifact registry" (REQ-WIZ-006, review B1).
PROMOTED_FOR_WIZARD = {"artifact_registry"}
ON_PREM_GEAR = {"bare_metal_host", "hypervisor_cluster", "san", "file_storage", "switch", "router", "firewall",
                "load_balancer", "network_segment", "zone", "site", "backup_target"}


def test_the_catalogue_schema_is_a_valid_json_schema_and_the_catalogue_matches_it():
    Draft202012Validator.check_schema(SCHEMA)
    errors = sorted(Draft202012Validator(SCHEMA).iter_errors(CATALOG), key=lambda e: list(e.absolute_path))
    assert not errors, [f"{list(e.absolute_path)}: {e.message}" for e in errors[:5]]


def test_role_ids_are_unique_and_every_layer_is_used_and_ordered():
    assert len(ROLES) == len(CATALOG["roles"])
    assert {role["layer"] for role in ROLES.values()} == LAYERS
    assert sorted(layer["order"] for layer in CATALOG["layers"]) == list(range(1, len(LAYERS) + 1))


def test_size_is_about_forty_roles_in_about_eleven_layers():
    assert 38 <= len(ROLES) <= 48
    assert len(LAYERS) == 11


def test_it_covers_every_v21_must_and_should_role_with_the_v21_ids():
    assert set(ROLES) >= V21_MUST, f"missing Must roles: {sorted(V21_MUST - set(ROLES))}"
    assert set(ROLES) >= V21_SHOULD, f"missing Should roles: {sorted(V21_SHOULD - set(ROLES))}"
    assert set(ROLES) == V21_MUST | V21_SHOULD | PROMOTED_FOR_WIZARD, "no role outside v2.1 without a reason"
    for role_id in V21_MUST:
        assert ROLES[role_id]["priority"] == "must", role_id
    for role_id in V21_SHOULD:
        assert ROLES[role_id]["priority"] == "should", role_id


def test_on_prem_equipment_is_first_class():
    assert set(ROLES) >= ON_PREM_GEAR
    assert sorted(CONTAINERS) == ["container_platform", "hypervisor_cluster", "network_segment", "site", "zone"]


def test_every_role_has_bilingual_copy_and_distinct_labels():
    for role in ROLES.values():
        for key in ("label", "purpose"):
            assert role[key]["en"].strip() and role[key]["vi"].strip(), (role["id"], key)
    english = [role["label"]["en"].lower() for role in ROLES.values()]
    assert len(english) == len(set(english)), "two roles share an English label"


def test_every_role_is_the_child_of_exactly_one_nest_rule():
    child_rules = [rule for rule in CATALOG["nestRules"] if rule["kind"] == "child"]
    for role_id in ROLES:
        owners = [rule["id"] for rule in child_rules if role_id in rule["roles"]]
        assert len(owners) == 1, (role_id, owners)


def test_nest_rules_only_name_known_roles_and_parents_are_containers():
    ids = [rule["id"] for rule in CATALOG["nestRules"]]
    assert len(ids) == len(set(ids))
    for rule in CATALOG["nestRules"]:
        for role_id in rule["roles"]:
            assert role_id in ROLES, (rule["id"], role_id)
        for parent in rule.get("parents", []):
            assert parent in ("root", "*") or parent in CONTAINERS, (rule["id"], parent)
        for child in rule.get("accepts", []):
            assert child in ROLES, (rule["id"], child)
        if rule["kind"] == "container":
            assert set(rule["roles"]) <= CONTAINERS, rule["id"]


def test_v21_nesting_chain_and_hypervisor_rule_are_expressible():
    """REQ-DES-004: site > zone > network_segment > component; hypervisor_cluster > virtual_machine."""
    def parents_of(role_id):
        return next(r["parents"] for r in CATALOG["nestRules"] if r["kind"] == "child" and role_id in r["roles"])

    assert "site" in parents_of("zone")
    assert "zone" in parents_of("network_segment")
    assert "network_segment" in parents_of("service")
    assert "hypervisor_cluster" in parents_of("virtual_machine")
    hypervisor = next(r for r in CATALOG["nestRules"] if r["kind"] == "container" and "hypervisor_cluster" in r["roles"])
    assert "virtual_machine" in hypervisor["accepts"]
    assert "service" not in hypervisor["accepts"]


def test_variants_defaults_and_fields_are_consistent():
    for role in ROLES.values():
        variant_ids = [v["id"] for v in role.get("variants", [])]
        assert len(variant_ids) == len(set(variant_ids)), role["id"]
        if "defaultVariant" in role:
            assert role["defaultVariant"] in variant_ids, role["id"]
        keys = [f["key"] for f in role["fields"]]
        assert len(keys) == len(set(keys)), role["id"]
        for field in role["fields"]:
            default = field.get("default")
            if default is None:
                continue
            if field["kind"] == "enum":
                assert default in field["values"], (role["id"], field["key"])
            if field["kind"] in ("int", "number"):
                assert field.get("min", default) <= default <= field.get("max", default), (role["id"], field["key"])
            if field["kind"] == "bool":
                assert isinstance(default, bool), (role["id"], field["key"])


def test_access_modes_are_known_edge_modes():
    for role in ROLES.values():
        for side in ("asSource", "asTarget"):
            assert set(role["accessModes"][side]) <= EDGE_MODES, (role["id"], side)


def test_annotations_and_external_nodes_bear_no_code():
    """REQ-DES-016."""
    for role_id in ("note", "shape", "text", "client", "external_service"):
        assert ROLES[role_id]["codeBearing"] is False, role_id


def test_aliases_and_legacy_types_point_at_real_roles_and_variants():
    for table_name, table in [("aliases", CATALOG["aliases"]), *CATALOG["legacyTypes"].items()]:
        for name, ref in table.items():
            assert ref["role"] in ROLES, (table_name, name)
            if "variant" in ref:
                assert ref["variant"] in {v["id"] for v in ROLES[ref["role"]].get("variants", [])}, (table_name, name)
    assert not set(CATALOG["aliases"]) & set(ROLES), "an alias must not shadow a canonical role id"


# --------------------------------------------------------------------------
# Agreement with the wire contract
# --------------------------------------------------------------------------


def test_legacy_1_0_types_cover_the_frozen_1_0_enum_exactly():
    assert set(CATALOG["legacyTypes"]["1.0"]) == set(CONTRACT["$defs"]["nodeType"]["enum"])


def test_attribute_enums_match_the_contract():
    contract_attrs = CONTRACT["$defs"]["nodeAttributes"]["properties"]
    catalogue_attrs = {a["key"]: a for a in CATALOG["attributes"]}
    assert set(catalogue_attrs) == set(contract_attrs)
    for key, attr in catalogue_attrs.items():
        if attr["kind"] == "enum":
            assert attr["values"] == contract_attrs[key]["enum"], key
    assert set(CATALOG["sizeClasses"]) == set(contract_attrs["sizeClass"]["enum"])


def test_edge_modes_match_the_contract():
    assert [m["id"] for m in CATALOG["edgeModes"]] == CONTRACT["$defs"]["edgeMode"]["enum"]


def test_role_ids_fit_the_contract_role_pattern():
    pattern = re.compile(CONTRACT["$defs"]["roleId"]["pattern"])
    for role_id in ROLES:
        assert pattern.match(role_id), role_id


# --------------------------------------------------------------------------
# NFR2-NEUT-001: provider neutrality
# --------------------------------------------------------------------------

_TOKEN_RE = re.compile(r"(?<![a-z0-9])(" + "|".join(re.escape(t.lower()) for t in TOKENS) + r")(?![a-z0-9])")


def neutrality_hits(value, path="$", *, skip=()):
    """Every (path, token) where a token appears as a whole word in a key or string value."""
    hits = []
    if isinstance(value, dict):
        for key, item in value.items():
            child = f"{path}.{key}"
            if child in skip:
                continue
            hits += [(child, m) for m in _TOKEN_RE.findall(key.lower())]
            hits += neutrality_hits(item, child, skip=skip)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            hits += neutrality_hits(item, f"{path}[{index}]", skip=skip)
    elif isinstance(value, str):
        hits += [(path, m) for m in _TOKEN_RE.findall(value.lower())]
    return hits


def test_the_neutrality_scanner_actually_finds_tokens():
    """Negative control: a scanner that finds nothing proves nothing."""
    assert neutrality_hits({"label": "Amazon RDS for PostgreSQL"}) == [("$.label", "amazon"), ("$.label", "rds")]
    assert neutrality_hits({"vsphere": 1}) == [("$.vsphere", "vsphere")]
    assert neutrality_hits({"label": "cards"}) == [], "whole words only: 'rds' inside 'cards' is fine"


def test_the_catalogue_contains_no_provider_or_vendor_term():
    assert neutrality_hits(CATALOG, skip={"$.description"}) == []


def test_the_contract_names_no_provider_in_any_property_or_enum():
    def names_and_enums(node, found):
        if isinstance(node, dict):
            for key, item in node.items():
                if key == "properties" and isinstance(item, dict):
                    found.extend(item)
                if key in ("enum", "const"):
                    found.extend(item if isinstance(item, list) else [item])
                names_and_enums(item, found)
        elif isinstance(node, list):
            for item in node:
                names_and_enums(item, found)
        return found

    words = [w for w in names_and_enums(CONTRACT, []) if isinstance(w, str)]
    assert [w for w in words if _TOKEN_RE.search(w.lower())] == []


@pytest.mark.parametrize(
    "fixture",
    [c["fixture"] for c in MANIFEST["cases"] if c["expect"] == "valid" and ".v2-" in c["fixture"]]
    + [m["expected"] for m in MANIFEST["migrations"]],
)
def test_valid_v2_documents_are_neutral_outside_deployment(fixture):
    document = json.loads((CONTRACTS_DIR / "fixtures" / fixture).read_text(encoding="utf-8"))
    assert neutrality_hits(document, skip={"$.deployment"}) == []


# --------------------------------------------------------------------------
# The runtime loader (app/catalog.py)
# --------------------------------------------------------------------------


def test_the_loader_reads_the_same_file_and_indexes_it():
    from app.catalog import load_catalog

    catalog = load_catalog()
    assert catalog.version == CATALOG["version"]
    assert set(catalog.roles) == set(ROLES)
    assert catalog.variants_of("service") == frozenset({"web", "api", "worker", "scheduler"})
    assert catalog.variants_of("relational_db") == frozenset()
    assert catalog.max_nesting_depth == CATALOG["limits"]["maxNestingDepth"]
    assert catalog.canonical_for("database").role == "relational_db"
    assert catalog.canonical_for("subnet").describe() == "network_segment (variant subnet)"
    assert catalog.canonical_for("quantum_router") is None


def test_the_loader_refuses_an_alias_to_a_missing_role():
    from app.catalog import CatalogError, parse_catalog

    broken = json.loads(json.dumps(CATALOG))
    broken["aliases"]["vm"] = {"role": "virtual_server"}
    with pytest.raises(CatalogError, match=r"aliases\.vm points at unknown role"):
        parse_catalog(broken, SCHEMA)


def test_the_loader_refuses_a_catalogue_that_breaks_its_schema():
    from app.catalog import CatalogError, parse_catalog

    broken = json.loads(json.dumps(CATALOG))
    broken["roles"][0]["label"] = {"en": "Client"}
    with pytest.raises(CatalogError, match="does not match its schema"):
        parse_catalog(broken, SCHEMA)


def test_the_loader_refuses_duplicate_role_ids():
    from app.catalog import CatalogError, parse_catalog

    broken = json.loads(json.dumps(CATALOG))
    broken["roles"].append(broken["roles"][0])
    with pytest.raises(CatalogError, match="duplicate role id 'client'"):
        parse_catalog(broken, SCHEMA)
