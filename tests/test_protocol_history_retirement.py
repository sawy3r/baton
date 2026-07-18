import copy
import hashlib
import json
import unittest
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

from protocol_history_git_fixture import (
    ProtocolHistoryRepositoryFixture,
    evaluate_protocol_history_retirement,
    mark_shipped_predicate,
    merge_release_predicate,
    merge_track_predicate,
)


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "schemas" / "slice-status-v1.json"
FIXTURE_PATH = ROOT / "tests" / "fixtures" / "protocol-history-retirement-cases.json"


class ProtocolHistoryRetirementContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = json.loads(SCHEMA_PATH.read_text())
        cls.fixture = json.loads(FIXTURE_PATH.read_text())
        cls.validator = Draft202012Validator(cls.schema, format_checker=FormatChecker())
        cls.git_fixture = ProtocolHistoryRepositoryFixture(SCHEMA_PATH)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.git_fixture.close()

    def assert_valid(self, instance: dict) -> None:
        errors = sorted(self.validator.iter_errors(instance), key=lambda error: list(error.path))
        self.assertEqual([], [error.message for error in errors])

    def test_positive_retirement_fixture_validates(self) -> None:
        self.assert_valid(self.fixture["valid"])
        status = self.fixture["valid"]
        typed = status["verification"]["violations"][0]["protocol_history_invalid"]
        self.assertEqual(status["retirement"]["invalid_history"], typed["invalid_history"])
        self.assertEqual(
            {"status_commit", "status_path", "status_blob_oid"},
            set(status["retirement"]["verifier_verdict"]),
        )

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

    def test_real_git_lifecycle_reaches_integration_only_after_exact_rollback(self) -> None:
        tip = self.git_fixture.commits["legal"]
        ready, failures = evaluate_protocol_history_retirement(self.git_fixture, tip)
        self.assertTrue(ready, failures)
        self.assertTrue(merge_track_predicate(self.git_fixture, tip))
        self.assertTrue(merge_release_predicate(self.git_fixture, tip))
        self.assertTrue(mark_shipped_predicate(self.git_fixture, tip))

    def test_real_git_lifecycle_negative_branches_fail_every_integrator_gate(self) -> None:
        scenarios = {
            "missing_rollback": "rollback-id-missing",
            "wrong_rollback": "rollback-id-missing",
            "out_of_order": "replacement-before-rollback-order",
            "rollback_deferred": "rollback-not-verified",
            "content_mismatch": "rollback-tree-mismatch:app.txt",
            "mode_mismatch": "rollback-tree-mismatch:app.txt",
            "identity_mismatch": "verifier-retirement-evidence-mismatch",
            "verdict_reference_mismatch": "verdict-blob-mismatch",
            "typed_evidence_mismatch": "verifier-retirement-evidence-mismatch",
            "maintainability_mutation": "maintainability-bytes-changed",
            "replacement_before_rollback": "replacement-started-before-rollback-verification",
            "ordinary_relabel": "cited-record-valid",
        }
        for scenario, expected_failure in scenarios.items():
            with self.subTest(scenario=scenario):
                tip = self.git_fixture.commits[scenario]
                ready, failures = evaluate_protocol_history_retirement(self.git_fixture, tip)
                self.assertFalse(ready)
                self.assertIn(expected_failure, failures)
                self.assertFalse(merge_track_predicate(self.git_fixture, tip))
                self.assertFalse(merge_release_predicate(self.git_fixture, tip))
                self.assertFalse(mark_shipped_predicate(self.git_fixture, tip))

    def test_integrator_entrypoints_apply_their_independent_outer_gates(self) -> None:
        tip = self.git_fixture.commits["legal"]
        self.assertFalse(merge_release_predicate(self.git_fixture, tip, track_integrated=False))
        self.assertFalse(mark_shipped_predicate(self.git_fixture, tip, release_merged=False))
        self.assertFalse(mark_shipped_predicate(self.git_fixture, tip, deployed=False))

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

    def test_each_integrator_surface_carries_the_complete_retirement_predicate(self) -> None:
        requirements = {
            "commands/merge-track.md": [
                "commit/path/blob identity",
                "typed-evidence equality",
                "byte-identical",
                "before every functional replacement",
                "mode/object equality",
                "ordinary-failure",
            ],
            "commands/merge-release.md": [
                "commit/path/blob identities",
                "typed-evidence equality",
                "byte-preserved maintainability",
                "sequential ordering",
                "complete-envelope equality",
            ],
            "commands/mark-shipped.md": [
                "commit/path/blob identities",
                "typed violation evidence exactly equals",
                "byte-identical",
                "before every functional replacement",
                "complete authored envelope",
            ],
        }
        for relative_path, clauses in requirements.items():
            contract = " ".join((ROOT / relative_path).read_text().split())
            for clause in clauses:
                with self.subTest(surface=relative_path, clause=clause):
                    self.assertIn(clause, contract)


if __name__ == "__main__":
    unittest.main()
