#!/usr/bin/env python3
"""Run Baton's portable strict-JSON, plan-v2, and receipt-v1 checks."""

from __future__ import annotations

import hashlib
import json
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
RECEIPT_SCHEMA = ROOT / "schemas" / "receipt-v1.json"
RECORD_VALIDATOR = ROOT / "conformance" / "validate.mjs"
MANIFEST = ROOT / "conformance" / "manifest.json"
MAX_SAFE_INTEGER = 9_007_199_254_740_991
REQUIRED_JSONSCHEMA_VERSION = "4.10.3"
RECEIPT_TRAILER = b"Baton-Receipt: "

STRICT_CASES = (
    ("raw-valid-edge.json", True, None),
    ("raw-invalid-duplicate-key.json", False, "duplicate_key"),
    ("raw-invalid-nonfinite.json", False, "nonfinite_number"),
    ("raw-invalid-unicode.json", False, "invalid_unicode"),
    ("raw-invalid-unsafe-integer.json", False, "unsafe_integer"),
    ("raw-invalid-unsafe-float.json", False, "unsafe_integer"),
    ("raw-invalid-unsafe-exponent.json", False, "unsafe_integer"),
)

VALID_PLAN_FIXTURES = (
    "valid-plan-v2.md",
    "valid-plan-revision-v2.md",
    "valid-plan-transitive-overlap-v2.md",
)

INVALID_PLAN_FIXTURES = (
    ("invalid-plan-broken-revision-v2.md", "INVALID_FIELD"),
    ("invalid-plan-serial-cycle-v2.md", "DEPENDENCY_CYCLE"),
    ("invalid-plan-cross-layer-cycle-v2.md", "DEPENDENCY_CYCLE"),
)

VALID_RECEIPT_FIXTURES = (
    "valid-slice-receipt.txt",
    "valid-assembly-receipt.txt",
)

INVALID_SCHEMA_RECEIPT_FIXTURES = (
    "invalid-unknown-field-receipt.txt",
    "invalid-runtime-no-verdict-receipt.txt",
)

INVALID_SEMANTIC_RECEIPT_FIXTURES = (
    ("invalid-role-result-receipt.txt", "INVALID_FIELD"),
    ("invalid-stale-detail-receipt.txt", "STALE_BINDING"),
)

REFERENCE_SUITES = (
    "test/records/receipts.test.mjs",
    "test/records/receipt-git.test.mjs",
    "test/records/actions.test.mjs",
    "test/records/git-boundary.test.mjs",
    "test/records/git-trust-adversarial.test.mjs",
)

PORTABLE_COMMANDS = (
    "python3 conformance/check.py",
    "node --test test/records/*.test.mjs test/operations/*.test.mjs "
    "test/skills/*.test.mjs test/board/*.test.mjs "
    "test/release/*.test.mjs",
)

PORTABLE_CASES = (
    (
        "strict-plan-v2-and-receipt-v1",
        (
            "conformance/check.py",
            REFERENCE_SUITES[0],
            REFERENCE_SUITES[1],
        ),
    ),
    (
        "forward-revision-stable-attempts-and-selective-invalidation",
        (
            REFERENCE_SUITES[2],
            "test/board/oracle.test.mjs",
        ),
    ),
    (
        "fixed-git-boundary-reconciliation-and-exact-composition",
        REFERENCE_SUITES[2:],
    ),
    (
        "operations-standalone-skills-and-agent-led-install-contract",
        (
            "test/operations/operations.test.mjs",
            "test/skills/generated.test.mjs",
            "test/skills/docs.test.mjs",
        ),
    ),
    (
        "git-derived-oracle-terminal-and-performance",
        (
            "test/board/oracle.test.mjs",
            "test/board/terminal.test.mjs",
            "test/board/performance.test.mjs",
        ),
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
    "fresh-verifier-thread-and-read-only-invocation-dispatch",
    "one-writer-per-track-with-independent-track-concurrency",
    "procedural-retry-and-git-reconciliation-without-verdict",
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


def receipt_instance(path: Path) -> Any:
    data = path.read_bytes()
    if b"\r" in data or not data.endswith(b"\n"):
        raise StrictJSONError(
            "invalid_receipt_commit",
            "receipt commit must be LF-only and end with LF",
        )
    trailer = data[:-1].split(b"\n")[-1]
    if not trailer.startswith(RECEIPT_TRAILER):
        raise StrictJSONError(
            "invalid_receipt_commit",
            "receipt commit lacks a final Baton-Receipt trailer",
        )
    return strict_load_bytes(trailer[len(RECEIPT_TRAILER) :])


def reference_validation(kind: str, path: Path) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        ["node", str(RECORD_VALIDATOR), kind, str(path)],
        cwd=ROOT,
        check=False,
        capture_output=True,
        text=True,
    )


def reference_error(result: subprocess.CompletedProcess[str]) -> str | None:
    if result.returncode == 0:
        return None
    lines = result.stderr.strip().splitlines()
    return lines[0] if lines else "VALIDATION_ERROR"


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
    schema_digest = "sha256:" + hashlib.sha256(RECEIPT_SCHEMA.read_bytes()).hexdigest()
    return {
        "schema_version": "baton.conformance-manifest/v2",
        "baton_version": (ROOT / "VERSION").read_text(encoding="utf-8").strip(),
        "profiles": {
            "portable_kit": {
                "status": "EXECUTABLE",
                "commands": list(PORTABLE_COMMANDS),
                "record_contract": {
                    "plan": {
                        "format": "baton.plan/v2",
                        "valid_fixtures": [
                            f"conformance/fixtures/{name}"
                            for name in VALID_PLAN_FIXTURES
                        ],
                        "invalid_fixtures": [
                            {
                                "instance": f"conformance/fixtures/{name}",
                                "error": error,
                            }
                            for name, error in INVALID_PLAN_FIXTURES
                        ],
                    },
                    "receipt": {
                        "representation": "Baton-Receipt Git trailer",
                        "schema": {
                            "path": "schemas/receipt-v1.json",
                            "digest": schema_digest,
                        },
                        "valid_fixtures": [
                            f"conformance/fixtures/{name}"
                            for name in VALID_RECEIPT_FIXTURES
                        ],
                        "invalid_schema_fixtures": [
                            f"conformance/fixtures/{name}"
                            for name in INVALID_SCHEMA_RECEIPT_FIXTURES
                        ],
                        "invalid_semantic_fixtures": [
                            {
                                "instance": f"conformance/fixtures/{name}",
                                "error": error,
                            }
                            for name, error in INVALID_SEMANTIC_RECEIPT_FIXTURES
                        ],
                    },
                    "strict_json_cases": strict_cases,
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


def manifest_paths(manifest: dict[str, Any]) -> list[str]:
    portable = manifest["profiles"]["portable_kit"]
    contract = portable["record_contract"]
    plan = contract["plan"]
    receipt = contract["receipt"]
    return [
        *[case["instance"] for case in contract["strict_json_cases"]],
        *plan["valid_fixtures"],
        *[case["instance"] for case in plan["invalid_fixtures"]],
        receipt["schema"]["path"],
        *receipt["valid_fixtures"],
        *receipt["invalid_schema_fixtures"],
        *[case["instance"] for case in receipt["invalid_semantic_fixtures"]],
        portable["measurements"]["baseline"],
        manifest["profiles"]["autonomous_engine"]["adapter_contract"],
        *[
            suite
            for case in portable["cases"]
            for suite in case["suites"]
        ],
    ]


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

    for relative_path in manifest_paths(manifest):
        path = ROOT / relative_path
        if not path.is_file():
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

    try:
        schema = strict_load(RECEIPT_SCHEMA)
        Draft202012Validator.check_schema(schema)
    except (OSError, StrictJSONError, SchemaError) as error:
        failures.append(f"receipt-v1 schema: {error}")
        return failures
    validator = Draft202012Validator(schema)

    for name in VALID_PLAN_FIXTURES:
        result = reference_validation("plan", FIXTURES / name)
        if result.returncode != 0:
            failures.append(
                f"{name}: reference rejection: {reference_error(result)}"
            )

    for name, expected_error in INVALID_PLAN_FIXTURES:
        result = reference_validation("plan", FIXTURES / name)
        actual_error = reference_error(result)
        if actual_error != expected_error:
            failures.append(
                f"{name}: expected {expected_error}, got {actual_error or 'valid'}"
            )

    for name in VALID_RECEIPT_FIXTURES:
        path = FIXTURES / name
        try:
            instance = receipt_instance(path)
        except (OSError, StrictJSONError) as error:
            failures.append(f"{name}: receipt extraction rejection: {error}")
            continue
        errors = list(validator.iter_errors(instance))
        if errors:
            failures.append(f"{name}: schema rejection: {errors[0].message}")
            continue
        result = reference_validation("receipt-commit", path)
        if result.returncode != 0:
            failures.append(
                f"{name}: reference rejection: {reference_error(result)}"
            )

    for name in INVALID_SCHEMA_RECEIPT_FIXTURES:
        path = FIXTURES / name
        try:
            instance = receipt_instance(path)
        except (OSError, StrictJSONError) as error:
            failures.append(f"{name}: receipt extraction rejection: {error}")
            continue
        if not list(validator.iter_errors(instance)):
            failures.append(f"{name}: unexpectedly schema-valid")
        if reference_validation("receipt-commit", path).returncode == 0:
            failures.append(f"{name}: unexpectedly accepted by the reference validator")

    for name, expected_error in INVALID_SEMANTIC_RECEIPT_FIXTURES:
        path = FIXTURES / name
        try:
            instance = receipt_instance(path)
        except (OSError, StrictJSONError) as error:
            failures.append(f"{name}: receipt extraction rejection: {error}")
            continue
        errors = list(validator.iter_errors(instance))
        if errors:
            failures.append(
                f"{name}: expected schema-valid semantic negative, "
                f"got schema rejection: {errors[0].message}"
            )
            continue
        result = reference_validation("receipt-commit", path)
        actual_error = reference_error(result)
        if actual_error != expected_error:
            failures.append(
                f"{name}: expected {expected_error}, got {actual_error or 'valid'}"
            )

    if not failures:
        print(
            "PASS 7 strict JSON cases, 1 Draft 2020-12 receipt schema, "
            "6 plan fixtures, and 6 receipt fixtures"
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
