#!/usr/bin/env python3
"""Run Baton's portable strict-JSON and work-status-v1 conformance checks."""

from __future__ import annotations

import json
import hashlib
import math
import subprocess
import sys
from importlib.metadata import version
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
REQUIRED_JSONSCHEMA_VERSION = "4.10.3"

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
    "test/records/actions.test.mjs",
    "test/records/schema.test.mjs",
    "test/records/transition.test.mjs",
    "test/records/git-topology.test.mjs",
    "test/records/product-tree.test.mjs",
    "test/records/hardening.test.mjs",
    "test/records/git-trust-adversarial.test.mjs",
)

PORTABLE_COMMANDS = (
    "python3 conformance/check.py",
    "node --test test/records/*.test.mjs test/operations/*.test.mjs "
    "test/adapters/*.test.mjs test/install/*.test.mjs test/board/*.test.mjs "
    "test/driver/*.test.mjs test/dogfood/*.test.mjs test/release/*.test.mjs",
)

PORTABLE_CASES = (
    (
        "strict-plan-status-and-sole-schema",
        (
            "conformance/check.py",
            "test/records/schema.test.mjs",
            "test/records/transition.test.mjs",
        ),
    ),
    (
        "owner-aware-git-topology-and-cas",
        REFERENCE_SUITES[0:1] + REFERENCE_SUITES[3:],
    ),
    (
        "operations-generated-adapters-and-install",
        (
            "test/operations/operations.test.mjs",
            "test/adapters/generated.test.mjs",
            "test/install/install.test.mjs",
        ),
    ),
    (
        "oracle-terminal-webui-and-performance",
        (
            "test/board/cli.test.mjs",
            "test/board/oracle.test.mjs",
            "test/board/terminal.test.mjs",
            "test/board/web.test.mjs",
            "test/board/performance.test.mjs",
        ),
    ),
    (
        "role-neutral-fake-driver",
        ("test/driver/fake-driver.test.mjs",),
    ),
    (
        "real-git-manual-dogfood",
        ("test/dogfood/*.test.mjs",),
    ),
    (
        "release-overhead-and-manifest-truth",
        (
            "test/release/conformance.test.mjs",
            "test/release/overhead.test.mjs",
        ),
    ),
)

AUTONOMOUS_CASES = (
    "protected-external-approval",
    "role-instruction-credential-workspace-process-isolation",
    "clean-read-only-fresh-verifier-dispatch",
    "one-writer-per-track-with-independent-track-concurrency",
    "durable-invocation-attempt-and-effect-identity",
    "crash-recovery-at-every-effect-boundary",
    "timeout-cancellation-cleanup-and-bounded-retry",
    "dependency-scheduling-and-one-serial-worker-per-track",
    "exact-track-composition-and-ownership-transfer",
    "fresh-assembly-verification",
    "moved-target-compare-and-set-refusal",
    "exact-release-integration",
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
    schema_digest = "sha256:" + hashlib.sha256(STATUS_SCHEMA.read_bytes()).hexdigest()
    return {
        "schema_version": "baton.conformance-manifest/v2",
        "baton_version": (ROOT / "VERSION").read_text(encoding="utf-8").strip(),
        "profiles": {
            "portable_kit": {
                "status": "EXECUTABLE",
                "commands": list(PORTABLE_COMMANDS),
                "record_contract": {
                    "schema": {
                        "path": "schemas/work-status-v1.json",
                        "digest": schema_digest,
                    },
                    "strict_json_cases": strict_cases,
                    "valid_status_fixtures": [
                        f"conformance/fixtures/{name}"
                        for name in VALID_STATUS_FIXTURES
                    ],
                    "invalid_schema_fixtures": [
                        f"conformance/fixtures/{name}"
                        for name in INVALID_SCHEMA_FIXTURES
                    ],
                    "invalid_semantic_fixtures": [
                        f"conformance/fixtures/{name}"
                        for name in INVALID_SEMANTIC_FIXTURES
                    ],
                },
                "cases": [
                    {"id": case_id, "suites": list(suites)}
                    for case_id, suites in PORTABLE_CASES
                ],
                "measurements": {
                    "command": "node scripts/measure-overhead.mjs --check",
                    "baseline": "conformance/baselines/v0.16.0-overhead.json",
                },
            },
            "autonomous_engine": {
                "status": "NOT RUN",
                "adapter_contract": "conformance/engine-adapter.md",
                "cases": [
                    {"id": case_id, "status": "NOT RUN"}
                    for case_id in AUTONOMOUS_CASES
                ],
            },
        },
    }


def run() -> list[str]:
    failures: list[str] = []

    if version("jsonschema") != REQUIRED_JSONSCHEMA_VERSION:
        failures.append(
            "jsonschema version: expected "
            f"{REQUIRED_JSONSCHEMA_VERSION}, got {version('jsonschema')}"
        )
        return failures

    try:
        manifest = strict_load(MANIFEST)
    except (OSError, StrictJSONError) as error:
        failures.append(f"conformance manifest: {error}")
        return failures
    expected = expected_manifest()
    if manifest != expected:
        failures.append("conformance manifest does not match the executable fixture inventory")
        return failures
    portable = manifest["profiles"]["portable_kit"]
    record_contract = portable["record_contract"]
    manifest_paths = [
        case["instance"] for case in record_contract["strict_json_cases"]
    ] + [
        record_contract["schema"]["path"],
        *record_contract["valid_status_fixtures"],
        *record_contract["invalid_schema_fixtures"],
        *record_contract["invalid_semantic_fixtures"],
        portable["measurements"]["baseline"],
        manifest["profiles"]["autonomous_engine"]["adapter_contract"],
        *[
            path
            for case in portable["cases"]
            for path in case["suites"]
        ],
    ]
    for relative_path in manifest_paths:
        if "*" in relative_path:
            matches = list(ROOT.glob(relative_path))
            if not matches or any(not match.is_file() for match in matches):
                failures.append(
                    f"conformance manifest pattern has no file matches: {relative_path}"
                )
        elif not (ROOT / relative_path).is_file():
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
