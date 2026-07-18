import copy
import hashlib
import json
import subprocess
import tempfile
from collections.abc import Callable
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker


SCHEMA_ID = "https://baton.sawy3r.net/schemas/slice-status-v1.json"
ORIGINAL_ID = "S01-original"
ROLLBACK_ID = "S02-rollback"
REPLACEMENT_ID = "S03-replacement"
STATUS_PATHS = {
    ORIGINAL_ID: "records/S01-original/status.json",
    ROLLBACK_ID: "records/S02-rollback/status.json",
    REPLACEMENT_ID: "records/S03-replacement/status.json",
}


class DuplicateJSONKeyError(ValueError):
    pass


def _unique_object(pairs: list[tuple[str, object]]) -> dict[str, object]:
    result: dict[str, object] = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateJSONKeyError(f"duplicate JSON member: {key}")
        result[key] = value
    return result


def parse_json(document: bytes | str) -> object:
    return json.loads(document, object_pairs_hook=_unique_object)


def render_json(value: object) -> bytes:
    return (json.dumps(value, indent=2) + "\n").encode()


def pointer(parts: object) -> str:
    return "".join(f"/{str(part).replace('~', '~0').replace('/', '~1')}" for part in parts)


def validation_fingerprints(errors: list[object]) -> list[str]:
    fingerprints = []
    for error in errors:
        payload = b"\0".join(
            value.encode()
            for value in (
                "baton-status-validation-error-v1",
                pointer(error.absolute_path),
                pointer(error.absolute_schema_path),
                str(error.validator),
                "",
            )
        )
        fingerprints.append(f"sha256:{hashlib.sha256(payload).hexdigest()}")
    return sorted(set(fingerprints))


def json_value_bytes(document: bytes, member: str) -> bytes:
    marker = f'"{member}"'.encode()
    marker_at = document.index(marker)
    value_at = document.index(b":", marker_at + len(marker)) + 1
    while document[value_at] in b" \r\n\t":
        value_at += 1
    text = document[value_at:].decode()
    _, consumed = json.JSONDecoder().raw_decode(text)
    return text[:consumed].encode()


class GitRepository:
    def __init__(self, root: Path):
        self.root = root
        self.run("init", "-q", "-b", "main")
        self.run("config", "user.name", "Baton Fixture")
        self.run("config", "user.email", "baton-fixture@example.invalid")

    def run(self, *args: str, input_bytes: bytes | None = None) -> str:
        result = subprocess.run(
            ["git", *args],
            cwd=self.root,
            input=input_bytes,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        )
        return result.stdout.decode().strip()

    def write(self, relative_path: str, value: bytes, executable: bool = False) -> None:
        path = self.root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(value)
        path.chmod(0o755 if executable else 0o644)

    def commit(self, message: str) -> str:
        self.run("add", "-A")
        self.run("commit", "-q", "-m", message)
        return self.run("rev-parse", "HEAD")

    def show(self, commit: str, relative_path: str) -> bytes:
        return subprocess.run(
            ["git", "show", f"{commit}:{relative_path}"],
            cwd=self.root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        ).stdout

    def blob(self, commit: str, relative_path: str) -> str:
        return self.run("rev-parse", f"{commit}:{relative_path}")

    def object_bytes(self, object_id: str) -> bytes:
        return subprocess.run(
            ["git", "cat-file", "blob", object_id],
            cwd=self.root,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=True,
        ).stdout

    def is_ancestor(self, ancestor: str, descendant: str) -> bool:
        return subprocess.run(
            ["git", "merge-base", "--is-ancestor", ancestor, descendant],
            cwd=self.root,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        ).returncode == 0

    def is_on_first_parent(self, commit: str, tip: str) -> bool:
        try:
            history = self.run("rev-list", "--first-parent", tip).splitlines()
        except subprocess.CalledProcessError:
            return False
        return commit in history

    def is_strictly_before_on_first_parent(self, earlier: str, later: str) -> bool:
        return earlier != later and self.is_on_first_parent(earlier, later)

    def tree_entry(self, commit: str, relative_path: str) -> tuple[str, str] | None:
        output = self.run("ls-tree", commit, "--", relative_path)
        if not output:
            return None
        metadata, _ = output.split("\t", 1)
        mode, object_type, object_id = metadata.split()
        if object_type != "blob":
            raise AssertionError(f"{relative_path} is not a blob")
        return mode, object_id

    def changed_non_record_paths(self, start: str, end: str) -> set[str]:
        commits = self.run("rev-list", "--reverse", "--first-parent", "--no-merges", f"{start}..{end}")
        paths: set[str] = set()
        for commit in commits.splitlines():
            if not commit:
                continue
            output = self.run("diff-tree", "--no-commit-id", "--name-only", "-r", "--no-renames", f"{commit}^1", commit)
            for path in output.splitlines():
                if path and not path.startswith(("records/", "schemas/")):
                    paths.add(path)
        return paths

    def commits_for_path(self, tip: str, relative_path: str) -> list[str]:
        output = self.run("log", "--reverse", "--first-parent", "--format=%H", tip, "--", relative_path)
        return [commit for commit in output.splitlines() if commit]


class ProtocolHistoryRepositoryFixture:
    def __init__(self, schema_path: Path):
        self.tempdir = tempfile.TemporaryDirectory()
        self.repo = GitRepository(Path(self.tempdir.name))
        self.schema = parse_json(schema_path.read_bytes())
        self.validator = Draft202012Validator(self.schema, format_checker=FormatChecker())
        self.commits: dict[str, str] = {}
        self._build(schema_path)

    def close(self) -> None:
        self.tempdir.cleanup()

    def _status(self, slice_id: str, state: str, start_commit: str | None, implementation_head: str | None, reports: list[dict], verification: dict) -> dict:
        return {
            "$schema": SCHEMA_ID,
            "slice_id": slice_id,
            "release": "2026-07-18-git-fixture",
            "track": "T1-fixture",
            "state": state,
            "start_commit": start_commit,
            "maintainability": {
                "state": "passed" if implementation_head else "pending",
                "cycle": 0,
                "implementation_head": implementation_head,
                "rollback_slice_id": None,
                "reports": reports,
                "adjudication": None,
            },
            "retirement": None,
            "open_deferrals": [],
            "verification": verification,
        }

    def _pass_report(self, role: str, phase: str, head: str, blob: str, invocation: str) -> dict:
        return {
            "role": role,
            "phase": phase,
            "cycle": 0,
            "invocation_id": invocation,
            "report_path": "records/report.json",
            "report_blob_oid": blob,
            "review_scope_head": head,
            "input_fingerprint": f"sha256:{'a' * 64}",
            "verdict": "PASS",
            "blocking_finding_ids": [],
        }

    def _write_status(self, slice_id: str, status: dict) -> None:
        self.repo.write(STATUS_PATHS[slice_id], render_json(status))

    def _write_order(self, order: list[str]) -> None:
        self.repo.write("records/track-order.json", render_json(order))

    def _build(self, schema_path: Path) -> None:
        self.repo.write("schemas/slice-status-v1.json", schema_path.read_bytes())
        self.repo.write("app.txt", b"baseline\n")
        self.repo.write("records/report.json", b'{"verdict":"PASS"}\n')
        self._write_order([ORIGINAL_ID, ROLLBACK_ID, REPLACEMENT_ID])
        self.commits["baseline"] = self.repo.commit("fixture: baseline")
        schema_blob = self.repo.blob(self.commits["baseline"], "schemas/slice-status-v1.json")

        invalid = {
            "$schema": SCHEMA_ID,
            "slice_id": ORIGINAL_ID,
            "release": "2026-07-18-git-fixture",
            "track": "T1-fixture",
            "state": "in_progress",
            "start_commit": self.commits["baseline"],
            "verification": {"result": "pending"},
        }
        self.repo.write("app.txt", b"invalid candidate\n")
        self._write_status(ORIGINAL_ID, invalid)
        self.commits["invalid"] = self.repo.commit("fixture: invalid historical lifecycle")
        invalid_blob = self.repo.blob(self.commits["invalid"], STATUS_PATHS[ORIGINAL_ID])
        errors = sorted(self.validator.iter_errors(invalid), key=lambda error: (list(error.path), list(error.schema_path)))
        fingerprints = validation_fingerprints(errors)
        self.invalid_history = [{
            "commit": self.commits["invalid"],
            "status_path": STATUS_PATHS[ORIGINAL_ID],
            "status_blob_oid": invalid_blob,
            "schema_id": SCHEMA_ID,
            "schema_blob_oid": schema_blob,
            "validation_error_fingerprints": fingerprints,
        }]

        report_blob = self.repo.blob(self.commits["invalid"], "records/report.json")
        implementation_reports = [self._pass_report("implementer", "preflight", self.commits["invalid"], report_blob, "impl-original")]
        implemented = self._status(
            ORIGINAL_ID,
            "implemented",
            self.commits["baseline"],
            self.commits["invalid"],
            implementation_reports,
            {"result": "pending", "violations": []},
        )
        self._write_status(ORIGINAL_ID, implemented)
        self.commits["implemented"] = self.repo.commit("fixture: current lifecycle valid")

        blocked = copy.deepcopy(implemented)
        blocked["verification"] = {
            "result": "blocked",
            "verifier_session_id": "fresh-verifier-fixture",
            "verifier_verdict_at": "2026-07-18T08:00:00Z",
            "verifier_was_fresh_context": True,
            "violations": [{
                "gate": "protocol_history_invalid",
                "description": "Immutable historical status does not validate.",
                "protocol_history_invalid": {
                    "disposition": "protocol_history_invalid",
                    "invalid_history": copy.deepcopy(self.invalid_history),
                },
            }],
        }
        self._write_status(ORIGINAL_ID, blocked)
        self.commits["blocked"] = self.repo.commit("fixture: fresh verifier blocked")
        blocked_blob = self.repo.blob(self.commits["blocked"], STATUS_PATHS[ORIGINAL_ID])

        retired = copy.deepcopy(blocked)
        retired["state"] = "deferred"
        retired["retirement"] = {
            "disposition": "protocol_history_invalid",
            "invalid_history": copy.deepcopy(self.invalid_history),
            "verifier_verdict": {
                "status_commit": self.commits["blocked"],
                "status_path": STATUS_PATHS[ORIGINAL_ID],
                "status_blob_oid": blocked_blob,
            },
            "rollback_slice_id": ROLLBACK_ID,
            "rationale": "Immutable lifecycle history prevents verification.",
            "tracking": "sawy3r/baton#80",
            "acknowledged_by": "coach",
            "acknowledged_at": "2026-07-18T08:30:00Z",
        }
        retired["open_deferrals"] = [{
            "why": "Immutable lifecycle history prevents verification.",
            "tracking": "sawy3r/baton#80",
            "acknowledgement": "Coach approved retirement and mandatory rollback.",
            "acknowledged_by": "coach",
        }]
        self._write_status(ORIGINAL_ID, retired)
        self.commits["retired"] = self.repo.commit("fixture: planner retires original")

        rollback_planned = self._status(ROLLBACK_ID, "planned", None, None, [], {"result": "pending", "violations": []})
        self._write_status(ROLLBACK_ID, rollback_planned)
        self.commits["rollback_planned"] = self.repo.commit("fixture: rollback planned")

        self.repo.write("app.txt", b"baseline\n")
        self.commits["rollback_candidate"] = self.repo.commit("fixture: rollback restores baseline")
        rollback_reports = [
            self._pass_report("implementer", "preflight", self.commits["rollback_candidate"], report_blob, "impl-rollback"),
            self._pass_report("verifier", "authoritative", self.commits["rollback_candidate"], report_blob, "verify-rollback"),
        ]
        rollback_verified = self._status(
            ROLLBACK_ID,
            "verified",
            self.commits["rollback_planned"],
            self.commits["rollback_candidate"],
            rollback_reports,
            {
                "result": "pass",
                "verifier_session_id": "fresh-rollback-verifier",
                "verifier_verdict_at": "2026-07-18T09:00:00Z",
                "verifier_was_fresh_context": True,
                "violations": [],
            },
        )
        self._write_status(ROLLBACK_ID, rollback_verified)
        self.commits["rollback_verified"] = self.repo.commit("fixture: rollback verified")

        replacement_planned = self._status(
            REPLACEMENT_ID,
            "planned",
            None,
            None,
            [],
            {"result": "pending", "violations": []},
        )
        self._write_status(REPLACEMENT_ID, replacement_planned)
        self.commits["replacement_anchor"] = self.repo.commit("fixture: replacement planned after rollback")

        replacement = self._status(
            REPLACEMENT_ID,
            "in_progress",
            self.commits["replacement_anchor"],
            None,
            [],
            {"result": "pending", "violations": []},
        )
        self._write_status(REPLACEMENT_ID, replacement)
        self.commits["legal"] = self.repo.commit("fixture: replacement starts after rollback")

        self._build_negative_branches(retired, rollback_verified)

    def _scenario(self, name: str, base: str, updates: Callable[[], None]) -> str:
        self.repo.run("checkout", "-q", "-B", f"scenario-{name}", base)
        updates()
        commit = self.repo.commit(f"fixture negative: {name}")
        self.commits[name] = commit
        return commit

    def _build_negative_branches(self, retired: dict, rollback_verified: dict) -> None:
        def original_at(base: str) -> dict:
            return json.loads(self.repo.show(base, STATUS_PATHS[ORIGINAL_ID]))

        self._scenario("missing_rollback", self.commits["retired"], lambda: self._write_mutated_original(self.commits["retired"], lambda value: value["retirement"].pop("rollback_slice_id")))
        self._scenario("wrong_rollback", self.commits["retired"], lambda: self._write_mutated_original(self.commits["retired"], lambda value: value["retirement"].update({"rollback_slice_id": "S99-wrong"})))

        def out_of_order() -> None:
            self._write_order([ORIGINAL_ID, REPLACEMENT_ID, ROLLBACK_ID])
        self._scenario("out_of_order", self.commits["legal"], out_of_order)

        def rollback_deferred() -> None:
            status = copy.deepcopy(rollback_verified)
            status["state"] = "deferred"
            self._write_status(ROLLBACK_ID, status)
        self._scenario("rollback_deferred", self.commits["legal"], rollback_deferred)

        def identity_mismatch() -> None:
            self._write_mutated_original(self.commits["retired"], lambda value: value["retirement"]["invalid_history"][0].update({"status_blob_oid": value["retirement"]["verifier_verdict"]["status_blob_oid"]}))
        self._scenario("identity_mismatch", self.commits["retired"], identity_mismatch)

        def verdict_reference_mismatch() -> None:
            self._write_mutated_original(
                self.commits["retired"],
                lambda value: value["retirement"]["verifier_verdict"].update(
                    {"status_blob_oid": value["retirement"]["invalid_history"][0]["status_blob_oid"]}
                ),
            )
        self._scenario("verdict_reference_mismatch", self.commits["retired"], verdict_reference_mismatch)

        def evidence_mismatch() -> None:
            self._write_mutated_original(self.commits["retired"], lambda value: value["retirement"]["invalid_history"][0]["validation_error_fingerprints"].append(f"sha256:{'f' * 64}"))
        self._scenario("typed_evidence_mismatch", self.commits["retired"], evidence_mismatch)

        def maintainability_mutation() -> None:
            self._write_mutated_original(self.commits["retired"], lambda value: value["maintainability"]["reports"][0].update({"invocation_id": "rewritten"}))
        self._scenario("maintainability_mutation", self.commits["retired"], maintainability_mutation)

        def maintainability_pending() -> None:
            self._write_mutated_original(self.commits["retired"], lambda value: value["maintainability"].update({"state": "pending"}))
        self._scenario("maintainability_pending", self.commits["retired"], maintainability_pending)

        def maintainability_no_head() -> None:
            self._write_mutated_original(self.commits["retired"], lambda value: value["maintainability"].update({"implementation_head": None}))
        self._scenario("maintainability_no_head", self.commits["retired"], maintainability_no_head)

        def maintainability_no_reports() -> None:
            self._write_mutated_original(self.commits["retired"], lambda value: value["maintainability"].update({"reports": []}))
        self._scenario("maintainability_no_reports", self.commits["retired"], maintainability_no_reports)

        def ordinary_relabel() -> None:
            value = original_at(self.commits["retired"])
            valid_evidence = copy.deepcopy(value["retirement"]["invalid_history"])
            valid_evidence[0]["commit"] = self.commits["implemented"]
            valid_evidence[0]["status_blob_oid"] = self.repo.blob(self.commits["implemented"], STATUS_PATHS[ORIGINAL_ID])
            value["retirement"]["invalid_history"] = valid_evidence
            value["verification"]["violations"][0]["protocol_history_invalid"]["invalid_history"] = copy.deepcopy(valid_evidence)
            self._write_status(ORIGINAL_ID, value)
        self._scenario("ordinary_relabel", self.commits["retired"], ordinary_relabel)

        def early_replacement() -> None:
            replacement = self._status(REPLACEMENT_ID, "in_progress", self.commits["rollback_planned"], None, [], {"result": "pending", "violations": []})
            self._write_status(REPLACEMENT_ID, replacement)
        self._scenario("replacement_before_rollback", self.commits["rollback_planned"], early_replacement)

        self._build_bad_tree("content_mismatch", b"not baseline\n", False)
        self._build_bad_tree("mode_mismatch", b"baseline\n", True)
        self._build_late_retirement(retired)
        self._build_owner_binding_negatives(retired)
        self._build_verdict_negatives(retired)
        self._build_combined_retirement_and_rollback(retired)
        self._build_second_parent_replacement_start()
        self._build_retirement_immutability_negatives(retired)
        self._build_current_schema_invalid_negatives()
        self.repo.run("checkout", "-q", "-B", "fixture-legal", self.commits["legal"])

    def _write_mutated_original(self, base: str, mutate: Callable[[dict], None]) -> None:
        value = json.loads(self.repo.show(base, STATUS_PATHS[ORIGINAL_ID]))
        mutate(value)
        self._write_status(ORIGINAL_ID, value)

    def _build_bad_tree(self, name: str, contents: bytes, executable: bool) -> None:
        self.repo.run("checkout", "-q", "-B", f"scenario-{name}", self.commits["rollback_planned"])
        self.repo.write("app.txt", contents, executable=executable)
        candidate = self.repo.commit(f"fixture negative candidate: {name}")
        report_blob = self.repo.blob(candidate, "records/report.json")
        reports = [
            self._pass_report("implementer", "preflight", candidate, report_blob, f"impl-{name}"),
            self._pass_report("verifier", "authoritative", candidate, report_blob, f"verify-{name}"),
        ]
        status = self._status(
            ROLLBACK_ID,
            "verified",
            self.commits["rollback_planned"],
            candidate,
            reports,
            {"result": "pass", "verifier_session_id": f"fresh-{name}", "verifier_verdict_at": "2026-07-18T09:00:00Z", "verifier_was_fresh_context": True, "violations": []},
        )
        self._write_status(ROLLBACK_ID, status)
        self._write_order([ORIGINAL_ID, ROLLBACK_ID, REPLACEMENT_ID])
        self.commits[name] = self.repo.commit(f"fixture negative: {name}")

    def _build_late_retirement(self, retired: dict) -> None:
        self.repo.run("checkout", "-q", "-B", "scenario-late_retirement", self.commits["blocked"])
        rollback_planned = self._status(ROLLBACK_ID, "planned", None, None, [], {"result": "pending", "violations": []})
        self._write_status(ROLLBACK_ID, rollback_planned)
        plan_commit = self.repo.commit("fixture negative: rollback planned before retirement")
        self.repo.write("app.txt", b"baseline\n")
        candidate = self.repo.commit("fixture negative: rollback restored before retirement")
        report_blob = self.repo.blob(candidate, "records/report.json")
        reports = [
            self._pass_report("implementer", "preflight", candidate, report_blob, "impl-late-retirement"),
            self._pass_report("verifier", "authoritative", candidate, report_blob, "verify-late-retirement"),
        ]
        rollback_verified = self._status(
            ROLLBACK_ID,
            "verified",
            plan_commit,
            candidate,
            reports,
            {"result": "pass", "verifier_session_id": "fresh-late-retirement", "verifier_verdict_at": "2026-07-18T09:00:00Z", "verifier_was_fresh_context": True, "violations": []},
        )
        self._write_status(ROLLBACK_ID, rollback_verified)
        rollback_verdict = self.repo.commit("fixture negative: rollback verified before retirement")
        replacement = self._status(REPLACEMENT_ID, "in_progress", rollback_verdict, None, [], {"result": "pending", "violations": []})
        self._write_status(REPLACEMENT_ID, replacement)
        self.repo.commit("fixture negative: replacement starts before retirement")
        self._write_status(ORIGINAL_ID, copy.deepcopy(retired))
        self.commits["late_retirement"] = self.repo.commit("fixture negative: retirement committed last")

    def _retirement_with_evidence(self, retired: dict, evidence: dict) -> dict:
        value = copy.deepcopy(retired)
        value["retirement"]["invalid_history"] = [copy.deepcopy(evidence)]
        value["verification"]["violations"][0]["protocol_history_invalid"]["invalid_history"] = [copy.deepcopy(evidence)]
        return value

    def _build_owner_binding_negatives(self, retired: dict) -> None:
        self.repo.run("checkout", "-q", "-B", "scenario-unrelated_evidence_slice", self.commits["legal"])
        rollback_commit = self.commits["rollback_planned"]
        evidence = copy.deepcopy(self.invalid_history[0])
        evidence.update({
            "commit": rollback_commit,
            "status_path": STATUS_PATHS[ROLLBACK_ID],
            "status_blob_oid": self.repo.blob(rollback_commit, STATUS_PATHS[ROLLBACK_ID]),
        })
        self._write_status(ORIGINAL_ID, self._retirement_with_evidence(retired, evidence))
        self.commits["unrelated_evidence_slice"] = self.repo.commit("fixture negative: cite another slice status")

        self.repo.run("checkout", "-q", "-B", "scenario-unrelated_evidence_release", self.commits["retired"])
        wrong_release = {
            "$schema": SCHEMA_ID,
            "slice_id": ORIGINAL_ID,
            "release": "unrelated-release",
            "state": "in_progress",
        }
        self._write_status(ORIGINAL_ID, wrong_release)
        wrong_release_commit = self.repo.commit("fixture negative: unrelated release status")
        evidence = copy.deepcopy(self.invalid_history[0])
        evidence.update({
            "commit": wrong_release_commit,
            "status_blob_oid": self.repo.blob(wrong_release_commit, STATUS_PATHS[ORIGINAL_ID]),
        })
        self._write_status(ORIGINAL_ID, self._retirement_with_evidence(retired, evidence))
        self.commits["unrelated_evidence_release"] = self.repo.commit("fixture negative: cite unrelated release status")

        self.repo.run("checkout", "-q", "-B", "evidence-second-parent", self.commits["retired"])
        second_parent_status = {
            "$schema": SCHEMA_ID,
            "slice_id": ORIGINAL_ID,
            "release": "2026-07-18-git-fixture",
            "track": "T1-second-parent",
            "state": "in_progress",
        }
        self._write_status(ORIGINAL_ID, second_parent_status)
        second_parent_commit = self.repo.commit("fixture negative: same slice status on side branch")
        self.repo.run("checkout", "-q", "-B", "scenario-second_parent_evidence", self.commits["retired"])
        self.repo.run("merge", "--no-ff", "-m", "fixture negative: merge evidence as second parent", "evidence-second-parent")
        evidence = copy.deepcopy(self.invalid_history[0])
        evidence.update({
            "commit": second_parent_commit,
            "status_blob_oid": self.repo.blob(second_parent_commit, STATUS_PATHS[ORIGINAL_ID]),
        })
        self._write_status(ORIGINAL_ID, self._retirement_with_evidence(retired, evidence))
        self.commits["second_parent_evidence"] = self.repo.commit("fixture negative: cite second-parent evidence")

    def _build_verdict_negatives(self, retired: dict) -> None:
        def finish_retirement(name: str, verdict_commit: str) -> None:
            value = copy.deepcopy(retired)
            value["retirement"]["verifier_verdict"] = {
                "status_commit": verdict_commit,
                "status_path": STATUS_PATHS[ORIGINAL_ID],
                "status_blob_oid": self.repo.blob(verdict_commit, STATUS_PATHS[ORIGINAL_ID]),
            }
            self._write_status(ORIGINAL_ID, value)
            self.commits[name] = self.repo.commit(f"fixture negative: retire after {name}")

        self.repo.run("checkout", "-q", "-B", "scenario-schema_invalid_verdict", self.commits["implemented"])
        invalid_blocked = copy.deepcopy(retired)
        invalid_blocked["retirement"] = None
        invalid_blocked["state"] = "implemented"
        invalid_blocked["open_deferrals"] = "not-an-array"
        self._write_status(ORIGINAL_ID, invalid_blocked)
        invalid_verdict_commit = self.repo.commit("fixture negative: schema-invalid blocked verdict")
        finish_retirement("schema_invalid_verdict", invalid_verdict_commit)

        self.repo.run("checkout", "-q", "-B", "scenario-duplicate_key_verdict", self.commits["implemented"])
        valid_blocked = copy.deepcopy(retired)
        valid_blocked["retirement"] = None
        valid_blocked["state"] = "implemented"
        raw = render_json(valid_blocked)
        duplicate = raw[:-2] + b',\n  "verification": {"result": "pending", "violations": []}\n}\n'
        self.repo.write(STATUS_PATHS[ORIGINAL_ID], duplicate)
        duplicate_commit = self.repo.commit("fixture negative: duplicate-key blocked verdict")
        finish_retirement("duplicate_key_verdict", duplicate_commit)

        self.repo.run("checkout", "-q", "-B", "verdict-second-parent", self.commits["implemented"])
        self._write_status(ORIGINAL_ID, valid_blocked)
        second_parent_verdict = self.repo.commit("fixture negative: blocked verdict on side branch")
        self.repo.run("checkout", "-q", "-B", "scenario-second_parent_verdict", self.commits["implemented"])
        self.repo.run("merge", "--no-ff", "-m", "fixture negative: merge verdict as second parent", "verdict-second-parent")
        finish_retirement("second_parent_verdict", second_parent_verdict)

        malformed_shapes = {
            "gate_only_verdict": None,
            "null_typed_verdict": None,
            "scalar_typed_verdict": "not-an-object",
            "list_typed_verdict": [],
        }
        for name, typed_value in malformed_shapes.items():
            self.repo.run("checkout", "-q", "-B", f"scenario-{name}", self.commits["implemented"])
            malformed = copy.deepcopy(valid_blocked)
            violation = malformed["verification"]["violations"][0]
            if name == "gate_only_verdict":
                violation.pop("protocol_history_invalid")
            else:
                violation["protocol_history_invalid"] = typed_value
            self._write_status(ORIGINAL_ID, malformed)
            malformed_commit = self.repo.commit(f"fixture negative: {name}")
            finish_retirement(name, malformed_commit)

    def _build_combined_retirement_and_rollback(self, retired: dict) -> None:
        self.repo.run("checkout", "-q", "-B", "scenario-combined_retirement_rollback", self.commits["blocked"])
        self._write_status(ORIGINAL_ID, copy.deepcopy(retired))
        rollback_planned = self._status(ROLLBACK_ID, "planned", None, None, [], {"result": "pending", "violations": []})
        self._write_status(ROLLBACK_ID, rollback_planned)
        combined = self.repo.commit("fixture negative: retire and plan rollback together")
        self.repo.write("app.txt", b"baseline\n")
        candidate = self.repo.commit("fixture negative: combined case restores baseline")
        report_blob = self.repo.blob(candidate, "records/report.json")
        reports = [
            self._pass_report("implementer", "preflight", candidate, report_blob, "impl-combined"),
            self._pass_report("verifier", "authoritative", candidate, report_blob, "verify-combined"),
        ]
        rollback_verified = self._status(
            ROLLBACK_ID,
            "verified",
            combined,
            candidate,
            reports,
            {"result": "pass", "verifier_session_id": "fresh-combined", "verifier_verdict_at": "2026-07-18T09:00:00Z", "verifier_was_fresh_context": True, "violations": []},
        )
        self._write_status(ROLLBACK_ID, rollback_verified)
        verdict = self.repo.commit("fixture negative: combined case rollback verified")
        replacement_planned = self._status(REPLACEMENT_ID, "planned", None, None, [], {"result": "pending", "violations": []})
        self._write_status(REPLACEMENT_ID, replacement_planned)
        replacement_anchor = self.repo.commit("fixture negative: combined case replacement planned")
        replacement = self._status(REPLACEMENT_ID, "in_progress", replacement_anchor, None, [], {"result": "pending", "violations": []})
        self._write_status(REPLACEMENT_ID, replacement)
        self.commits["combined_retirement_rollback"] = self.repo.commit("fixture negative: combined case replacement starts")

    def _build_second_parent_replacement_start(self) -> None:
        self.repo.run("checkout", "-q", "-B", "replacement-start-second-parent", self.commits["rollback_verified"])
        self.repo.write("side-anchor.txt", b"second-parent replacement anchor\n")
        side_start = self.repo.commit("fixture negative: replacement anchor on side branch")
        self.repo.run("checkout", "-q", "-B", "scenario-second_parent_replacement_start", self.commits["replacement_anchor"])
        self.repo.run("merge", "--no-ff", "-m", "fixture negative: merge replacement anchor as second parent", "replacement-start-second-parent")
        replacement = self._status(REPLACEMENT_ID, "in_progress", side_start, None, [], {"result": "pending", "violations": []})
        self._write_status(REPLACEMENT_ID, replacement)
        self.commits["second_parent_replacement_start"] = self.repo.commit("fixture negative: reference second-parent replacement anchor")

    def _build_retirement_immutability_negatives(self, retired: dict) -> None:
        self.repo.run("checkout", "-q", "-B", "scenario-retirement_mutate_restore", self.commits["legal"])
        mutated = copy.deepcopy(retired)
        mutated["retirement"]["rationale"] = "Transient retirement rewrite must remain visible."
        self._write_status(ORIGINAL_ID, mutated)
        self.repo.commit("fixture negative: mutate retirement temporarily")
        self._write_status(ORIGINAL_ID, copy.deepcopy(retired))
        self.commits["retirement_mutate_restore"] = self.repo.commit("fixture negative: restore retirement bytes")

        self.repo.run("checkout", "-q", "-B", "scenario-retirement_wrong_rollback_rewrite", self.commits["blocked"])
        wrong = copy.deepcopy(retired)
        wrong["retirement"]["rollback_slice_id"] = "S99-wrong"
        self._write_status(ORIGINAL_ID, wrong)
        self.repo.commit("fixture negative: retire with wrong rollback id")
        rollback_planned = self._status(ROLLBACK_ID, "planned", None, None, [], {"result": "pending", "violations": []})
        self._write_status(ROLLBACK_ID, rollback_planned)
        plan_commit = self.repo.commit("fixture negative: real rollback planned")
        self.repo.write("app.txt", b"baseline\n")
        candidate = self.repo.commit("fixture negative: real rollback restores baseline")
        report_blob = self.repo.blob(candidate, "records/report.json")
        reports = [
            self._pass_report("implementer", "preflight", candidate, report_blob, "impl-wrong-rewrite"),
            self._pass_report("verifier", "authoritative", candidate, report_blob, "verify-wrong-rewrite"),
        ]
        rollback = self._status(
            ROLLBACK_ID,
            "verified",
            plan_commit,
            candidate,
            reports,
            {"result": "pass", "verifier_session_id": "fresh-wrong-rewrite", "verifier_verdict_at": "2026-07-18T09:00:00Z", "verifier_was_fresh_context": True, "violations": []},
        )
        self._write_status(ROLLBACK_ID, rollback)
        self.repo.commit("fixture negative: real rollback verified")
        replacement_planned = self._status(REPLACEMENT_ID, "planned", None, None, [], {"result": "pending", "violations": []})
        self._write_status(REPLACEMENT_ID, replacement_planned)
        replacement_anchor = self.repo.commit("fixture negative: replacement planned after real rollback")
        replacement = self._status(REPLACEMENT_ID, "in_progress", replacement_anchor, None, [], {"result": "pending", "violations": []})
        self._write_status(REPLACEMENT_ID, replacement)
        self.repo.commit("fixture negative: replacement starts after real rollback")
        self._write_status(ORIGINAL_ID, copy.deepcopy(retired))
        self.commits["retirement_wrong_rollback_rewrite"] = self.repo.commit("fixture negative: rewrite retirement to real rollback")

    def _build_current_schema_invalid_negatives(self) -> None:
        def invalid_history_null() -> None:
            self._write_mutated_original(self.commits["legal"], lambda value: value["retirement"].update({"invalid_history": None}))

        def maintainability_null() -> None:
            self._write_mutated_original(self.commits["legal"], lambda value: value.update({"maintainability": None}))

        self._scenario("current_invalid_history_null", self.commits["legal"], invalid_history_null)
        self._scenario("current_maintainability_null", self.commits["legal"], maintainability_null)

    def track_order(self, tip: str) -> list[str]:
        return json.loads(self.repo.show(tip, "records/track-order.json"))


def evaluate_protocol_history_retirement(fixture: ProtocolHistoryRepositoryFixture, tip: str) -> tuple[bool, list[str]]:
    repo = fixture.repo
    failures: list[str] = []
    try:
        current_bytes = repo.show(tip, STATUS_PATHS[ORIGINAL_ID])
        current = parse_json(current_bytes)
    except (subprocess.CalledProcessError, json.JSONDecodeError, DuplicateJSONKeyError):
        return False, ["original-status-missing"]
    schema_errors = list(fixture.validator.iter_errors(current))
    if schema_errors:
        return False, ["current-status-invalid"]
    retirement = current.get("retirement")
    if not isinstance(retirement, dict) or retirement.get("disposition") != "protocol_history_invalid":
        return False, failures + ["retirement-missing"]
    if current.get("state") != "deferred":
        failures.append("original-not-deferred")
    maintainability = current.get("maintainability", {})
    implementation_head = maintainability.get("implementation_head")
    reports = maintainability.get("reports", [])
    if maintainability.get("state") != "passed":
        failures.append("retirement-maintainability-not-passed")
    if not implementation_head:
        failures.append("retirement-implementation-head-missing")
    qualifying_reports = [
        report
        for report in reports
        if report.get("verdict") == "PASS" and report.get("review_scope_head") == implementation_head
    ]
    if not reports or not qualifying_reports or reports[-1] not in qualifying_reports:
        failures.append("retirement-pass-ledger-insufficient")
    if implementation_head and not repo.is_ancestor(implementation_head, tip):
        failures.append("retirement-implementation-head-not-in-history")

    def first_status_commit(path: str, predicate: Callable[[dict], bool]) -> str | None:
        for commit in repo.commits_for_path(tip, path):
            try:
                status = parse_json(repo.show(commit, path))
            except (subprocess.CalledProcessError, json.JSONDecodeError, DuplicateJSONKeyError):
                continue
            if isinstance(status, dict) and predicate(status):
                return commit
        return None

    retirement_commit = first_status_commit(
        STATUS_PATHS[ORIGINAL_ID],
        lambda status: isinstance(status.get("retirement"), dict),
    )
    if not retirement_commit:
        failures.append("retirement-transition-missing")
    else:
        try:
            retirement_bytes = json_value_bytes(
                repo.show(retirement_commit, STATUS_PATHS[ORIGINAL_ID]),
                "retirement",
            )
            status_commits = repo.commits_for_path(tip, STATUS_PATHS[ORIGINAL_ID])
            retirement_index = status_commits.index(retirement_commit)
            for status_commit in status_commits[retirement_index:]:
                candidate_bytes = json_value_bytes(
                    repo.show(status_commit, STATUS_PATHS[ORIGINAL_ID]),
                    "retirement",
                )
                if candidate_bytes != retirement_bytes:
                    failures.append("retirement-history-mutated")
                    break
        except (ValueError, IndexError, subprocess.CalledProcessError, json.JSONDecodeError):
            failures.append("retirement-history-mutated")

    verdict_ref = retirement.get("verifier_verdict", {})
    verdict_commit = verdict_ref.get("status_commit", "")
    verdict_path = verdict_ref.get("status_path", "")
    verdict_blob = verdict_ref.get("status_blob_oid", "")
    try:
        if verdict_path != STATUS_PATHS[ORIGINAL_ID]:
            failures.append("verdict-path-mismatch")
        if not retirement_commit or not repo.is_strictly_before_on_first_parent(verdict_commit, retirement_commit):
            failures.append("verdict-not-before-retirement-first-parent")
        pinned_verdict_bytes = repo.show(verdict_commit, verdict_path)
        if repo.blob(verdict_commit, verdict_path) != verdict_blob:
            failures.append("verdict-blob-mismatch")
        pinned_verdict = parse_json(pinned_verdict_bytes)
        if not isinstance(pinned_verdict, dict):
            failures.append("verdict-status-invalid")
            pinned_verdict = {}
        if pinned_verdict.get("slice_id") != ORIGINAL_ID or pinned_verdict.get("release") != current.get("release"):
            failures.append("verdict-status-identity-mismatch")
        pinned_schema_bytes = repo.show(verdict_commit, "schemas/slice-status-v1.json")
        pinned_schema = parse_json(pinned_schema_bytes)
        Draft202012Validator.check_schema(pinned_schema)
        if pinned_schema.get("$id") != pinned_verdict.get("$schema"):
            failures.append("verdict-schema-identity-mismatch")
        verdict_validator = Draft202012Validator(pinned_schema, format_checker=FormatChecker())
        if list(verdict_validator.iter_errors(pinned_verdict)):
            failures.append("verdict-status-invalid")
    except DuplicateJSONKeyError:
        pinned_verdict_bytes = b"{}"
        pinned_verdict = {}
        failures.append("verdict-duplicate-json-key")
    except (subprocess.CalledProcessError, json.JSONDecodeError, ValueError):
        pinned_verdict_bytes = b"{}"
        pinned_verdict = {}
        failures.append("verdict-unresolvable")
    verification = pinned_verdict.get("verification", {})
    if not isinstance(verification, dict):
        verification = {}
    if verification.get("result") != "blocked" or verification.get("verifier_was_fresh_context") is not True:
        failures.append("verdict-not-fresh-blocked")
    violations = verification.get("violations", [])
    if not isinstance(violations, list):
        violations = []
    typed = [
        violation.get("protocol_history_invalid")
        for violation in violations
        if isinstance(violation, dict) and violation.get("gate") == "protocol_history_invalid"
    ]
    if len(typed) != 1 or not isinstance(typed[0], dict) or typed[0].get("invalid_history") != retirement.get("invalid_history"):
        failures.append("verifier-retirement-evidence-mismatch")
    try:
        if json_value_bytes(pinned_verdict_bytes, "maintainability") != json_value_bytes(current_bytes, "maintainability"):
            failures.append("maintainability-bytes-changed")
    except (ValueError, IndexError, json.JSONDecodeError):
        failures.append("maintainability-bytes-unreadable")

    for evidence in retirement.get("invalid_history", []):
        try:
            commit = evidence["commit"]
            path = evidence["status_path"]
            if path != STATUS_PATHS[ORIGINAL_ID]:
                failures.append("invalid-record-owner-path-mismatch")
            if not repo.is_strictly_before_on_first_parent(commit, verdict_commit):
                failures.append("invalid-record-not-before-verdict-first-parent")
            raw = repo.show(commit, path)
            if repo.blob(commit, path) != evidence["status_blob_oid"]:
                failures.append("invalid-record-blob-mismatch")
            pinned_schema = parse_json(repo.object_bytes(evidence["schema_blob_oid"]))
            if pinned_schema.get("$id") != evidence["schema_id"]:
                failures.append("schema-identity-mismatch")
            validator = Draft202012Validator(pinned_schema, format_checker=FormatChecker())
            status = parse_json(raw)
            if status.get("slice_id") != ORIGINAL_ID or status.get("release") != current.get("release"):
                failures.append("invalid-record-owner-identity-mismatch")
            errors = sorted(validator.iter_errors(status), key=lambda error: (list(error.path), list(error.schema_path)))
            if not errors:
                failures.append("cited-record-valid")
            if validation_fingerprints(errors) != evidence["validation_error_fingerprints"]:
                failures.append("validation-fingerprint-mismatch")
        except (KeyError, subprocess.CalledProcessError, json.JSONDecodeError, DuplicateJSONKeyError):
            failures.append("invalid-history-unresolvable")

    rollback_id = retirement.get("rollback_slice_id")
    order = fixture.track_order(tip)
    if rollback_id not in order:
        failures.append("rollback-id-missing")
        return False, sorted(set(failures))
    original_index = order.index(ORIGINAL_ID)
    rollback_index = order.index(rollback_id)
    if rollback_index <= original_index:
        failures.append("rollback-before-original")
    if REPLACEMENT_ID in order and order.index(REPLACEMENT_ID) < rollback_index:
        failures.append("replacement-before-rollback-order")
    rollback_plan_commit = first_status_commit(STATUS_PATHS[rollback_id], lambda _status: True)
    rollback_verdict_commit = first_status_commit(
        STATUS_PATHS[rollback_id],
        lambda status: status.get("state") in {"verified", "shipped"}
        and status.get("maintainability", {}).get("state") == "passed"
        and any(
            report.get("role") == "verifier"
            and report.get("phase") == "authoritative"
            and report.get("verdict") == "PASS"
            for report in status.get("maintainability", {}).get("reports", [])
        ),
    )
    if not rollback_plan_commit:
        failures.append("rollback-plan-transition-missing")
    elif not retirement_commit or not repo.is_strictly_before_on_first_parent(retirement_commit, rollback_plan_commit):
        failures.append("retirement-after-rollback-planning")
    if not rollback_verdict_commit:
        failures.append("qualifying-rollback-verdict-missing")
    else:
        if not retirement_commit or not repo.is_strictly_before_on_first_parent(retirement_commit, rollback_verdict_commit):
            failures.append("retirement-after-rollback-verification")
        if rollback_plan_commit and not repo.is_strictly_before_on_first_parent(rollback_plan_commit, rollback_verdict_commit):
            failures.append("rollback-verdict-before-planning")
    try:
        rollback = parse_json(repo.show(tip, STATUS_PATHS[rollback_id]))
    except (subprocess.CalledProcessError, json.JSONDecodeError, DuplicateJSONKeyError):
        return False, sorted(set(failures + ["rollback-status-missing"]))
    rollback_is_verified = rollback.get("state") in {"verified", "shipped"}
    if not rollback_is_verified:
        failures.append("rollback-not-verified")
    rollback_head = rollback.get("maintainability", {}).get("implementation_head")
    start = current.get("start_commit")
    if not rollback_head or not start:
        failures.append("rollback-boundary-missing")
    else:
        paths = repo.changed_non_record_paths(start, rollback_head)
        if not paths:
            failures.append("rollback-envelope-empty")
        for path in paths:
            if repo.tree_entry(start, path) != repo.tree_entry(rollback_head, path):
                failures.append(f"rollback-tree-mismatch:{path}")

    try:
        replacement = parse_json(repo.show(tip, STATUS_PATHS[REPLACEMENT_ID]))
    except (subprocess.CalledProcessError, json.JSONDecodeError, DuplicateJSONKeyError):
        replacement = None
    if replacement and replacement.get("start_commit"):
        if not repo.is_on_first_parent(replacement["start_commit"], tip):
            failures.append("replacement-start-not-on-owner-first-parent")
        if not rollback_is_verified:
            failures.append("replacement-started-before-rollback-verification")
        if not rollback_verdict_commit or not repo.is_strictly_before_on_first_parent(rollback_verdict_commit, replacement["start_commit"]):
            failures.append("replacement-started-before-rollback-verdict")
        if not retirement_commit or not repo.is_strictly_before_on_first_parent(retirement_commit, replacement["start_commit"]):
            failures.append("replacement-started-before-retirement")
    return not failures, sorted(set(failures))


def merge_track_predicate(fixture: ProtocolHistoryRepositoryFixture, tip: str) -> bool:
    ready, _ = evaluate_protocol_history_retirement(fixture, tip)
    return ready


def merge_release_predicate(fixture: ProtocolHistoryRepositoryFixture, tip: str, track_integrated: bool = True) -> bool:
    ready, _ = evaluate_protocol_history_retirement(fixture, tip)
    return track_integrated and ready


def mark_shipped_predicate(fixture: ProtocolHistoryRepositoryFixture, tip: str, release_merged: bool = True, deployed: bool = True) -> bool:
    ready, _ = evaluate_protocol_history_retirement(fixture, tip)
    return release_merged and deployed and ready
