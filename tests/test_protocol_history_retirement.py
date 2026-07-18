import copy
import hashlib
import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "schemas" / "slice-status-v1.json"
FIXTURE_PATH = ROOT / "tests" / "fixtures" / "protocol-history-retirement-cases.json"


class ProtocolHistoryRetirementContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = json.loads(SCHEMA_PATH.read_text())
        cls.fixture = json.loads(FIXTURE_PATH.read_text())
        cls.validator = Draft202012Validator(cls.schema, format_checker=FormatChecker())

    def assert_valid(self, instance: dict) -> None:
        errors = sorted(self.validator.iter_errors(instance), key=lambda error: list(error.path))
        self.assertEqual([], [error.message for error in errors])

    def test_positive_retirement_fixture_validates(self) -> None:
        self.assert_valid(self.fixture["valid"])

    def test_negative_retirement_fixtures_fail_closed(self) -> None:
        for case in self.fixture["invalid_cases"]:
            with self.subTest(case=case["name"]):
                instance = copy.deepcopy(self.fixture["valid"])
                target = instance
                for member in case["path"][:-1]:
                    target = target[member]
                leaf = case["path"][-1]
                if case.get("delete"):
                    del target[leaf]
                else:
                    target[leaf] = case["value"]
                self.assertTrue(list(self.validator.iter_errors(instance)))

    def test_retirement_is_separate_from_maintainability(self) -> None:
        instance = copy.deepcopy(self.fixture["valid"])
        before = json.dumps(instance["maintainability"], separators=(",", ":"), sort_keys=False).encode()
        instance["retirement"]["rationale"] += " Evidence remains immutable."
        after = json.dumps(instance["maintainability"], separators=(",", ":"), sort_keys=False).encode()
        self.assertEqual(hashlib.sha256(before).digest(), hashlib.sha256(after).digest())
        self.assert_valid(instance)

    def test_validation_error_fingerprint_vector(self) -> None:
        vector = self.fixture["fingerprint_vector"]
        payload = b"\0".join(
            value.encode()
            for value in (
                "baton-status-validation-error-v1",
                vector["instance_pointer"],
                vector["schema_pointer"],
                vector["keyword"],
                "",
            )
        )
        self.assertEqual(vector["expected"], f"sha256:{hashlib.sha256(payload).hexdigest()}")

    def test_integration_and_replacement_reachability_vectors(self) -> None:
        for case in self.fixture["integration_cases"]:
            with self.subTest(case=case["name"]):
                ready = (
                    case["evidence_reproduces"]
                    and case["maintainability_bytes_equal"]
                    and case["rollback_state"] in {"verified", "shipped"}
                    and case["tree_equal"]
                )
                self.assertEqual(case["integration_ready"], ready)
                self.assertEqual(case["replacement_may_start"], ready)

    def test_all_normative_surfaces_name_the_disposition_and_rollback(self) -> None:
        surfaces = [
            "baton/track-mode.md",
            "baton/role-prompts/planner.md",
            "baton/role-prompts/implementer.md",
            "baton/role-prompts/verifier.md",
            "baton/llm-checks/README.md",
            "baton/llm-checks/maintainability-review.md",
            "commands/replan-release.md",
            "commands/implement-slice.md",
            "commands/verify-slice.md",
            "commands/merge-track.md",
            "commands/merge-release.md",
            "commands/mark-shipped.md",
        ]
        for relative_path in surfaces:
            with self.subTest(surface=relative_path):
                contract = (ROOT / relative_path).read_text()
                self.assertIn("protocol_history_invalid", contract)
                self.assertIn("rollback", contract.lower())


if __name__ == "__main__":
    unittest.main()
