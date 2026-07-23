#!/usr/bin/env python3
"""Run Baton's portable strict-JSON and work-status-v1 conformance checks."""

from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path
from typing import Any

from jsonschema import Draft202012Validator
from jsonschema.exceptions import SchemaError


ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "conformance" / "fixtures"
SCHEMAS = ROOT / "schemas"
STATUS_SCHEMA = SCHEMAS / "work-status-v1.json"
STATUS_VALIDATOR = ROOT / "reference" / "records" / "records.mjs"
MANIFEST = ROOT / "conformance" / "manifest.json"
MAX_SAFE_INTEGER = 9_007_199_254_740_991

STRICT_CASES = (
    ("raw-valid-edge.json", True, None),
    ("raw-invalid-duplicate-key.json", False, "duplicate_key"),
    ("raw-invalid-nonfinite.json", False, "nonfinite_number"),
    ("raw-invalid-unicode.json", False, "invalid_unicode"),
    ("raw-invalid-unsafe-integer.json", False, "unsafe_integer"),
    ("raw-invalid-unsafe-float.json", False, "unsafe_integer"),
    ("raw-invalid-unsafe-exponent.json", False, "unsafe_integer"),
)

VALID_STATUS_FIXTURES = (
    "valid-work-status.json",
    "valid-assembly-status.json",
)

INVALID_SCHEMA_FIXTURES = (
    "invalid-active-status.json",
    "invalid-no-verdict-outcome.json",
    "invalid-unknown-field-status.json",
    "invalid-malformed-digest-status.json",
    "invalid-ref-status.json",
)

INVALID_SEMANTIC_FIXTURES = (
    "invalid-semantic-stale-proof-status.json",
)

REFERENCE_SUITES = (
    "test/records/schema.test.mjs",
    "test/records/transition.test.mjs",
    "test/records/git-topology.test.mjs",
    "test/records/product-tree.test.mjs",
)


class StrictJSONError(ValueError):
    """A deterministic strict-JSON rejection."""

    def __init__(self, code: str, detail: str) -> None:
        super().__init__(detail)
        self.code = code


def _object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise StrictJSONError("duplicate_key", f"duplicate object name {key!r}")
        result[key] = value
    return result


def _integer(value: str) -> int:
    parsed = int(value)
    if abs(parsed) > MAX_SAFE_INTEGER:
        raise StrictJSONError(
            "unsafe_integer",
            f"integer outside interoperable range: {value}",
        )
    return parsed


def _number(value: str) -> float:
    parsed = float(value)
    if not math.isfinite(parsed):
        raise StrictJSONError("nonfinite_number", f"non-finite number: {value}")
    if parsed.is_integer() and abs(parsed) > MAX_SAFE_INTEGER:
        raise StrictJSONError(
            "unsafe_integer",
            f"integer-valued number outside interoperable range: {value}",
        )
    return parsed


def _constant(value: str) -> None:
    raise StrictJSONError("nonfinite_number", f"non-finite number: {value}")


def _check_unicode(value: Any) -> None:
    if isinstance(value, str):
        if any(0xD800 <= ord(character) <= 0xDFFF for character in value):
            raise StrictJSONError("invalid_unicode", "lone UTF-16 surrogate")
    elif isinstance(value, list):
        for item in value:
            _check_unicode(item)
    elif isinstance(value, dict):
        for key, item in value.items():
            _check_unicode(key)
            _check_unicode(item)


def strict_load_bytes(data: bytes) -> Any:
    try:
        text = data.decode("utf-8", errors="strict")
    except UnicodeDecodeError as error:
        raise StrictJSONError("invalid_utf8", str(error)) from error
    try:
        value = json.loads(
            text,
            object_pairs_hook=_object,
            parse_int=_integer,
            parse_float=_number,
            parse_constant=_constant,
        )
    except StrictJSONError:
        raise
    except json.JSONDecodeError as error:
        raise StrictJSONError("invalid_json", str(error)) from error
    _check_unicode(value)
    return value


def strict_load(path: Path) -> Any:
    return strict_load_bytes(path.read_bytes())


def semantic_validation(path: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", str(STATUS_VALIDATOR), "status", str(path)],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )


def expected_manifest() -> dict[str, Any]:
    strict_cases = []
    for name, valid, error in STRICT_CASES:
        case: dict[str, Any] = {
            "instance": f"conformance/fixtures/{name}",
            "valid": valid,
        }
        if error is not None:
            case["error"] = error
        strict_cases.append(case)
    return {
        "schema_version": "baton.conformance-manifest/v1",
        "portable_command": "python3 conformance/check.py",
        "strict_json_cases": strict_cases,
        "status_schema": {
            "schema": "schemas/work-status-v1.json",
            "valid_instances": [
                f"conformance/fixtures/{name}" for name in VALID_STATUS_FIXTURES
            ],
            "invalid_schema_instances": [
                f"conformance/fixtures/{name}" for name in INVALID_SCHEMA_FIXTURES
            ],
            "invalid_semantic_instances": [
                f"conformance/fixtures/{name}" for name in INVALID_SEMANTIC_FIXTURES
            ],
        },
        "reference_command": "node --test test/records/*.test.mjs",
        "reference_suites": list(REFERENCE_SUITES),
    }


def run() -> list[str]:
    failures: list[str] = []

    try:
        manifest = strict_load(MANIFEST)
    except (OSError, StrictJSONError) as error:
        failures.append(f"conformance manifest: {error}")
        return failures
    expected = expected_manifest()
    if manifest != expected:
        failures.append("conformance manifest does not match the executable fixture inventory")
        return failures
    manifest_paths = [
        case["instance"] for case in manifest["strict_json_cases"]
    ] + [
        manifest["status_schema"]["schema"],
        *manifest["status_schema"]["valid_instances"],
        *manifest["status_schema"]["invalid_schema_instances"],
        *manifest["status_schema"]["invalid_semantic_instances"],
        *manifest["reference_suites"],
    ]
    for relative_path in manifest_paths:
        if not (ROOT / relative_path).is_file():
            failures.append(f"conformance manifest path does not exist: {relative_path}")
    if failures:
        return failures

    for name, expected_valid, expected_error in STRICT_CASES:
        actual_error: str | None = None
        try:
            strict_load(FIXTURES / name)
        except StrictJSONError as error:
            actual_error = error.code
        actual_valid = actual_error is None
        if actual_valid != expected_valid or (
            not expected_valid and actual_error != expected_error
        ):
            failures.append(
                f"{name}: expected valid={expected_valid} "
                f"error={expected_error}, got {actual_error or 'valid'}"
            )

    authored_schemas = sorted(SCHEMAS.glob("*.json"))
    if authored_schemas != [STATUS_SCHEMA]:
        relative = ", ".join(path.relative_to(ROOT).as_posix() for path in authored_schemas)
        failures.append(
            "schema inventory: expected only schemas/work-status-v1.json, "
            f"got {relative or 'none'}"
        )
        return failures

    try:
        schema = strict_load(STATUS_SCHEMA)
        Draft202012Validator.check_schema(schema)
    except (OSError, StrictJSONError, SchemaError) as error:
        failures.append(f"work-status-v1 schema: {error}")
        return failures
    validator = Draft202012Validator(schema)

    for name in VALID_STATUS_FIXTURES:
        path = FIXTURES / name
        try:
            instance = strict_load(path)
        except (OSError, StrictJSONError) as error:
            failures.append(f"{name}: strict JSON rejection: {error}")
            continue
        errors = sorted(
            validator.iter_errors(instance),
            key=lambda error: tuple(str(part) for part in error.path),
        )
        if errors:
            failures.append(f"{name}: schema rejection: {errors[0].message}")
            continue
        result = semantic_validation(path)
        if result.returncode != 0:
            detail = result.stderr.strip() or result.stdout.strip() or "unknown rejection"
            failures.append(f"{name}: semantic rejection: {detail}")

    for name in INVALID_SCHEMA_FIXTURES:
        path = FIXTURES / name
        try:
            instance = strict_load(path)
        except (OSError, StrictJSONError) as error:
            failures.append(f"{name}: fixture is not strict JSON: {error}")
            continue
        if not list(validator.iter_errors(instance)):
            failures.append(f"{name}: unexpectedly schema-valid")

    for name in INVALID_SEMANTIC_FIXTURES:
        path = FIXTURES / name
        try:
            instance = strict_load(path)
        except (OSError, StrictJSONError) as error:
            failures.append(f"{name}: fixture is not strict JSON: {error}")
            continue
        errors = list(validator.iter_errors(instance))
        if errors:
            failures.append(
                f"{name}: expected schema-valid semantic negative, "
                f"got schema rejection: {errors[0].message}"
            )
            continue
        result = semantic_validation(path)
        if result.returncode == 0:
            failures.append(f"{name}: unexpectedly semantically valid")

    if not failures:
        print(
            "PASS 7 strict JSON cases, 1 Draft 2020-12 schema, "
            "2 positive status fixtures, and 6 negative status fixtures"
        )
    return failures


def main() -> int:
    failures = run()
    if not failures:
        return 0
    for failure in failures:
        print(f"FAIL {failure}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
