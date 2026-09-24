"""The logical component catalogue, ``contracts/catalog/components.json`` (task 0.6).

Why Python reads it at all
--------------------------
The catalogue is data shared with the SPA (design-v2 D-03): the TypeScript
graph core uses it for the palette, NEST rules and validation; the backend uses
it for exactly one thing - catalogue MEMBERSHIP of a 2.0 node's ``type`` and
``variant`` (L1 integrity, ``app/graph_integrity.py``). Anything that interprets
meaning (containment rules, access modes, realisations) stays in TypeScript.

Like ``app/contract.py``, this module reads the one file both suites test and
refuses to start without it: a container built without the catalogue must fail
at start-up, not with a 500 on somebody's first save.

File location: the repo keeps it at ``ArchPilot/contracts/catalog/``; the
container copies it to ``/srv/contracts/catalog/``. ``ARCHPILOT_CATALOG_DIR``
overrides both.
"""

from __future__ import annotations

import json
import os
from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from types import MappingProxyType
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import best_match

from .config import BACKEND_ROOT

CATALOG_FILENAME = "components.json"
CATALOG_SCHEMA_FILENAME = "components.schema.json"


class CatalogError(RuntimeError):
    """The catalogue file is missing, malformed or internally inconsistent."""


@dataclass(frozen=True)
class RoleRef:
    """A catalogue role, optionally narrowed to one variant."""

    role: str
    variant: str | None = None

    def describe(self) -> str:
        return f"{self.role} (variant {self.variant})" if self.variant else self.role


@dataclass(frozen=True)
class Catalog:
    version: str
    roles: Mapping[str, Mapping[str, Any]]
    variants: Mapping[str, frozenset[str]]
    aliases: Mapping[str, RoleRef]
    legacy_types: Mapping[str, Mapping[str, RoleRef]]
    max_nesting_depth: int

    def is_role(self, role_id: object) -> bool:
        return isinstance(role_id, str) and role_id in self.roles

    def variants_of(self, role_id: str) -> frozenset[str]:
        return self.variants.get(role_id, frozenset())

    def canonical_for(self, name: str) -> RoleRef | None:
        """The canonical role an alias or legacy id stands for, if any.

        Used only to make an error message helpful. Aliases are resolved by the
        TypeScript migration, never accepted on save (graph_integrity)."""
        if name in self.aliases:
            return self.aliases[name]
        for type_map in self.legacy_types.values():
            if name in type_map:
                return type_map[name]
        return None


def candidate_dirs() -> list[Path]:
    override = os.environ.get("ARCHPILOT_CATALOG_DIR")
    if override:
        return [Path(override)]
    return [
        BACKEND_ROOT / "contracts" / "catalog",  # container: /srv/contracts/catalog
        BACKEND_ROOT.parent / "contracts" / "catalog",  # repo: ArchPilot/contracts/catalog
    ]


def _find_dir() -> Path:
    for directory in candidate_dirs():
        if (directory / CATALOG_FILENAME).is_file():
            return directory
    searched = ", ".join(str(d / CATALOG_FILENAME) for d in candidate_dirs())
    raise FileNotFoundError(f"component catalogue {CATALOG_FILENAME} not found; searched: {searched}")


def _role_ref(value: Mapping[str, Any]) -> RoleRef:
    return RoleRef(role=value["role"], variant=value.get("variant"))


def parse_catalog(document: Mapping[str, Any], schema: Mapping[str, Any]) -> Catalog:
    """Validate ``document`` against the catalogue schema and the few cross-
    references the runtime depends on, then build the lookup tables."""
    error = best_match(Draft202012Validator(schema).iter_errors(document))
    if error is not None:
        path = "/".join(str(part) for part in error.absolute_path) or "(root)"
        raise CatalogError(f"{CATALOG_FILENAME} does not match its schema at {path}: {error.message[:300]}")

    roles: dict[str, Mapping[str, Any]] = {}
    for role in document["roles"]:
        if role["id"] in roles:
            raise CatalogError(f"{CATALOG_FILENAME}: duplicate role id {role['id']!r}")
        roles[role["id"]] = role
    variants = {
        role_id: frozenset(v["id"] for v in role.get("variants", ())) for role_id, role in roles.items()
    }

    def checked(ref: RoleRef, where: str) -> RoleRef:
        if ref.role not in roles:
            raise CatalogError(f"{CATALOG_FILENAME}: {where} points at unknown role {ref.role!r}")
        if ref.variant is not None and ref.variant not in variants[ref.role]:
            raise CatalogError(f"{CATALOG_FILENAME}: {where} points at unknown variant {ref.describe()!r}")
        return ref

    aliases = {
        name: checked(_role_ref(value), f"aliases.{name}") for name, value in document["aliases"].items()
    }
    legacy = {
        version: MappingProxyType(
            {name: checked(_role_ref(value), f"legacyTypes.{version}.{name}") for name, value in type_map.items()}
        )
        for version, type_map in document["legacyTypes"].items()
    }
    return Catalog(
        version=document["version"],
        roles=MappingProxyType(roles),
        variants=MappingProxyType(variants),
        aliases=MappingProxyType(aliases),
        legacy_types=MappingProxyType(legacy),
        max_nesting_depth=int(document["limits"]["maxNestingDepth"]),
    )


@lru_cache(maxsize=1)
def load_catalog() -> Catalog:
    """Read, validate and index the catalogue once per process."""
    directory = _find_dir()
    try:
        document = json.loads((directory / CATALOG_FILENAME).read_text(encoding="utf-8"))
        schema = json.loads((directory / CATALOG_SCHEMA_FILENAME).read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise CatalogError(f"cannot read the component catalogue in {directory}: {exc}") from exc
    Draft202012Validator.check_schema(schema)
    return parse_catalog(document, schema)
