"""Pilot v1 WP-A wire models: rule packs and sizing runs (docs/v3/05).

Mirrors ``src/contracts/pilot.ts`` (``RulePack``, ``SizingModelDef``,
``SizingRun``). Kept out of ``app/schemas.py`` so three work packages do not
edit one file in parallel.

What the server checks, and what it does not
---------------------------------------------
* Shape and size: every field the contract defines, with caps (<= 50 models
  per pack, <= 200 calc steps per model, string lengths, list lengths). The
  whole request body is capped at 512 KiB by the routers.
* Finite numbers only: ``NaN``/``Infinity`` (which Python's JSON parser
  accepts) are a 422, so a stored body is always valid JSON.
* NOT formulas. The rule DSL is parsed, unit-checked and tested by the
  TypeScript engine (``src/domain/rules/engine.ts``, decision D3: sizing
  arithmetic lives in TypeScript only). A second Python parser would drift.
  The one rule enforced here is the cheap half of the 05 §7 publish gate:
  a ``published`` pack needs at least one test per model.

Request models ignore unknown keys on purpose: the SPA may PUT a whole
``RulePack`` object back (``id``, ``builtIn``, ``createdAt`` included), and
those are server-owned, so they are dropped rather than rejected. What is
stored is the validated model dumped by alias, so an unknown key never
reaches the database.
"""

from __future__ import annotations

import re
from typing import Annotated, Any, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator, model_validator
from pydantic.alias_generators import to_camel

MAX_RULE_BODY_BYTES = 512 * 1024
MAX_MODELS_PER_PACK = 50
MAX_CALC_PER_MODEL = 200

RuleStatus = Literal["draft", "published", "deprecated"]
RuleSeverity = Literal["info", "low", "medium", "high"]
RuleRounding = Literal["none", "ceil", "floor", "round"]

Identifier = Annotated[str, StringConstraints(min_length=1, max_length=64, pattern=r"^[A-Za-z_][A-Za-z0-9_]*$")]
# Output names are labels for tests and the HLD, not DSL identifiers.
OutputName = Annotated[str, StringConstraints(min_length=1, max_length=64)]
ShortText = Annotated[str, StringConstraints(max_length=200)]
LongText = Annotated[str, StringConstraints(max_length=4000)]
UnitText = Annotated[str, StringConstraints(max_length=64)]
Formula = Annotated[str, StringConstraints(min_length=1, max_length=4000)]
PackName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
ModelId = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)]
FiniteNumber = Annotated[float, Field(allow_inf_nan=False)]
NumberMap = Annotated[dict[Annotated[str, StringConstraints(max_length=64)], FiniteNumber], Field(max_length=200)]


class _Wire(BaseModel):
    """camelCase on the wire, unknown keys ignored, no NaN/Infinity, no ``model_`` namespace clash."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="ignore",
        allow_inf_nan=False,
        protected_namespaces=(),
    )


class RuleInputIn(_Wire):
    name: Identifier
    label_vi: ShortText = ""
    label_en: ShortText = ""
    unit: UnitText = ""
    default: FiniteNumber
    min: FiniteNumber | None = None
    max: FiniteNumber | None = None
    source: ShortText | None = None


class RuleParamIn(_Wire):
    name: Identifier
    value: FiniteNumber
    unit: UnitText = ""
    source: ShortText | None = None


# Functions an imported Excel formula may use: the same list as
# src/domain/rules/excel/translate.ts SUPPORTED_EXCEL_FUNCTIONS. Security review
# 2026-10-15 #1: packs are shared, so a stored formula such as WEBSERVICE(...)
# must never reach a colleague's export. The exporter re-checks with a real parser.
_EXCEL_FUNCTIONS = frozenset({
    "ROUND", "ROUNDUP", "ROUNDDOWN", "CEILING", "CEILING.MATH", "FLOOR", "FLOOR.MATH",
    "MAX", "MIN", "SUM", "AVERAGE", "ABS", "IF", "IFS", "AND", "OR", "NOT",
    "VLOOKUP", "XLOOKUP", "INDEX", "MATCH",
})
_EXCEL_CALL = re.compile(r"([A-Za-z_][A-Za-z0-9_.]*)\s*\(")


class RuleCalcIn(_Wire):
    name: Identifier
    formula: Formula
    unit: UnitText = ""
    description: LongText | None = None
    excel_formula: LongText | None = None

    @field_validator("excel_formula")
    @classmethod
    def _excel_formula_allow_list(cls, value: str | None) -> str | None:
        if value is None:
            return value
        # No sheet, external-workbook or structured references.
        if any(ch in value for ch in "!['"):
            raise ValueError("excelFormula: sheet or external references are not allowed")
        for match in _EXCEL_CALL.finditer(value):
            name = match.group(1).upper()
            for prefix in ("_XLFN.", "_XLWS."):
                if name.startswith(prefix):
                    name = name[len(prefix):]
            if name not in _EXCEL_FUNCTIONS:
                raise ValueError(f"excelFormula: function {name} is not allowed")
        return value


class RuleOutputIn(_Wire):
    name: OutputName
    from_: Identifier = Field(alias="from")
    unit: UnitText = ""
    rounding: RuleRounding | None = None
    label_vi: ShortText | None = None
    label_en: ShortText | None = None


class RuleWarningIn(_Wire):
    condition: Formula
    severity: RuleSeverity
    message_vi: LongText = ""
    message_en: LongText = ""


LookupCell = Annotated[str, StringConstraints(max_length=200)] | FiniteNumber


class RuleLookupIn(_Wire):
    name: Identifier
    columns: Annotated[
        list[Annotated[str, StringConstraints(min_length=1, max_length=64)]],
        Field(min_length=2, max_length=20),
    ]
    rows: Annotated[list[Annotated[list[LookupCell], Field(max_length=20)]], Field(max_length=1000)]


class RuleTestIn(_Wire):
    id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    inputs: NumberMap = Field(default_factory=dict)
    expected: NumberMap = Field(default_factory=dict)
    tolerance: Annotated[float, Field(ge=0, allow_inf_nan=False)] = 0.0


class SizingModelIn(_Wire):
    id: ModelId
    name_vi: ShortText = ""
    name_en: ShortText = ""
    component_type: Annotated[str, StringConstraints(max_length=64)] = ""
    description: LongText | None = None
    formula_mode: Literal["units", "excel"] | None = None
    inputs: Annotated[list[RuleInputIn], Field(max_length=200)] = Field(default_factory=list)
    params: Annotated[list[RuleParamIn], Field(max_length=200)] = Field(default_factory=list)
    calc: Annotated[list[RuleCalcIn], Field(max_length=MAX_CALC_PER_MODEL)] = Field(default_factory=list)
    outputs: Annotated[list[RuleOutputIn], Field(max_length=100)] = Field(default_factory=list)
    warnings: Annotated[list[RuleWarningIn], Field(max_length=100)] = Field(default_factory=list)
    lookups: Annotated[list[RuleLookupIn], Field(max_length=20)] = Field(default_factory=list)
    tests: Annotated[list[RuleTestIn], Field(max_length=100)] = Field(default_factory=list)


class RulePackWrite(_Wire):
    """POST and PUT body (``RulePackDraft`` in src/api/rulePacks.ts).

    ``version`` is accepted and ignored: the server sets 1 on create and
    current + 1 on every update. ``owner``/``builtIn``/``id`` are server-owned.
    """

    name: PackName
    status: RuleStatus = "draft"
    description: Annotated[str, StringConstraints(max_length=4000)] | None = None
    version: int | None = None
    models: Annotated[list[SizingModelIn], Field(max_length=MAX_MODELS_PER_PACK)]

    @model_validator(mode="after")
    def _model_ids_unique_and_publish_gate(self) -> RulePackWrite:
        ids = [model.id for model in self.models]
        duplicates = sorted({model_id for model_id in ids if ids.count(model_id) > 1})
        if duplicates:
            raise ValueError(f"model ids must be unique within a pack; repeated: {', '.join(duplicates)}")
        if self.status == "published":
            untested = [model.id for model in self.models if not model.tests]
            if untested:
                raise ValueError(
                    "a published pack needs at least one test per model (docs/v3/05 §7); "
                    f"no tests in: {', '.join(untested)}"
                )
        return self

    def models_json(self) -> list[dict[str, Any]]:
        """What is stored: camelCase, ``from`` restored, unset optionals omitted."""
        return [model.model_dump(by_alias=True, exclude_none=True) for model in self.models]


class RulePackOut(_Wire):
    id: str
    name: str
    version: int
    status: RuleStatus
    built_in: bool = False
    # The owner's username: readable, unique, and what the SPA's `User` carries.
    owner: str | None = None
    description: str | None = None
    # Stored already in wire shape; returned as-is rather than re-validated.
    models: list[dict[str, Any]]
    created_at: str
    updated_at: str


class RulePackListOut(_Wire):
    items: list[RulePackOut]
    total: int


# --------------------------------------------------------------------------
# Sizing runs
# --------------------------------------------------------------------------


class RunInputIn(_Wire):
    name: Identifier
    value: FiniteNumber
    unit: UnitText = ""
    source: ShortText | None = None


class RunStepIn(_Wire):
    name: Identifier
    formula: LongText
    substituted: LongText
    value: FiniteNumber
    unit: UnitText = ""


class RunOutputIn(_Wire):
    name: OutputName
    value: FiniteNumber
    unit: UnitText = ""
    label: ShortText | None = None


class RunWarningIn(_Wire):
    severity: RuleSeverity
    message_vi: LongText = ""
    message_en: LongText = ""


class SizingRunWrite(_Wire):
    """POST body: a ``SizingRun`` as ``evaluateModel`` returns it. ``id`` and
    ``createdAt`` are server-owned and ignored if sent."""

    design_id: Annotated[str, StringConstraints(min_length=1, max_length=64)] | None = None
    component_label: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None
    rule_pack_id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    rule_pack_version: Annotated[int, Field(ge=0)]
    model_id: ModelId
    model_name: ShortText = ""
    inputs: Annotated[list[RunInputIn], Field(max_length=500)] = Field(default_factory=list)
    steps: Annotated[list[RunStepIn], Field(max_length=MAX_CALC_PER_MODEL)] = Field(default_factory=list)
    outputs: Annotated[list[RunOutputIn], Field(max_length=100)] = Field(default_factory=list)
    binding: Annotated[str, StringConstraints(max_length=200)] | None = None
    warnings: Annotated[list[RunWarningIn], Field(max_length=100)] = Field(default_factory=list)

    def body_json(self) -> dict[str, Any]:
        """Everything except the columns (design id) and server-owned fields."""
        return self.model_dump(by_alias=True, exclude_none=True, exclude={"design_id"})


class SizingRunOut(_Wire):
    id: str
    design_id: str | None = None
    component_label: str | None = None
    rule_pack_id: str
    rule_pack_version: int
    model_id: str
    model_name: str
    inputs: list[dict[str, Any]]
    steps: list[dict[str, Any]]
    outputs: list[dict[str, Any]]
    binding: str | None = None
    warnings: list[dict[str, Any]]
    created_at: str


class SizingRunListOut(_Wire):
    items: list[SizingRunOut]
    total: int
