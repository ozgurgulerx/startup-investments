#!/usr/bin/env python3
"""
Verify that AKS pipelines CronJobs match the VM crontab schedule/timeout.

We intentionally keep the AKS CronJobs args aligned with the VM runner:
  runner.sh <job_name> <timeout_min> <script_path>

This script is dependency-free (no PyYAML); it parses the specific YAML structure
we commit under infrastructure/kubernetes/pipelines-cronjobs.yaml.
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
CRONTAB = REPO_ROOT / "infrastructure" / "vm-cron" / "crontab"
CRONJOBS = REPO_ROOT / "infrastructure" / "kubernetes" / "pipelines-cronjobs.yaml"


@dataclass(frozen=True)
class VmJob:
    name: str
    schedule: str
    timeout_min: str
    script_path: str


@dataclass(frozen=True)
class K8sCronJob:
    name: str
    schedule: str
    timeout_min: str
    script_path: str


def _parse_vm_crontab(path: Path) -> dict[str, VmJob]:
    jobs: dict[str, VmJob] = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue

        parts = line.split()
        # schedule(5) + runner.sh + job + timeout + script => 9 tokens minimum
        if len(parts) < 9:
            continue

        schedule = " ".join(parts[:5])
        cmd = parts[5:]

        # Only consider runner.sh lines.
        try:
            runner_idx = next(i for i, p in enumerate(cmd) if p.endswith("/runner.sh"))
        except StopIteration:
            continue

        # runner.sh <job> <timeout> <script>
        if len(cmd) < runner_idx + 4:
            continue

        job = cmd[runner_idx + 1]
        timeout = cmd[runner_idx + 2]
        script = cmd[runner_idx + 3]

        jobs[job] = VmJob(name=job, schedule=schedule, timeout_min=timeout, script_path=script)

    return jobs


def _parse_k8s_cronjobs(path: Path) -> dict[str, K8sCronJob]:
    docs = path.read_text(encoding="utf-8").split("\n---\n")
    out: dict[str, K8sCronJob] = {}

    for doc in docs:
        lines = doc.splitlines()
        name = ""
        schedule = ""
        args: list[str] = []

        in_metadata = False
        in_args = False
        args_indent = None

        for line in lines:
            if line.startswith("metadata:"):
                in_metadata = True
                continue

            if in_metadata and line.startswith("  name: "):
                name = line.split("  name: ", 1)[1].strip().strip('"')
                in_metadata = False  # metadata.name captured; ignore other "name:" keys
                continue

            if line.lstrip().startswith("schedule:"):
                # spec.schedule is the only schedule key we care about
                schedule = line.split("schedule:", 1)[1].strip().strip('"')
                continue

            if line.strip() == "args:":
                in_args = True
                args_indent = len(line) - len(line.lstrip())
                args = []
                continue

            if in_args:
                cur_indent = len(line) - len(line.lstrip())
                if args_indent is not None and cur_indent <= args_indent and line.strip():
                    in_args = False
                    args_indent = None
                    continue

                stripped = line.strip()
                if stripped.startswith("- "):
                    item = stripped[2:].strip()
                    # Keep quoting semantics aligned with YAML; strip outer quotes.
                    if item.startswith('"') and item.endswith('"') and len(item) >= 2:
                        item = item[1:-1]
                    args.append(item)

        if not name:
            continue

        if len(args) < 3:
            raise RuntimeError(f"CronJob/{name}: could not parse args (need 3, got {len(args)})")

        # args[0] is job name, args[1] is timeout, args[2] is script path.
        job_name = args[0]
        timeout = args[1]
        script = args[2]

        if job_name != name:
            raise RuntimeError(f"CronJob/{name}: args[0] mismatch (args[0]={job_name})")

        out[name] = K8sCronJob(name=name, schedule=schedule, timeout_min=timeout, script_path=script)

    return out


def main() -> int:
    if not CRONTAB.exists():
        print(f"ERROR: missing {CRONTAB}")
        return 2
    if not CRONJOBS.exists():
        print(f"ERROR: missing {CRONJOBS}")
        return 2

    vm = _parse_vm_crontab(CRONTAB)
    k8s = _parse_k8s_cronjobs(CRONJOBS)

    errors: list[str] = []

    for name, cj in sorted(k8s.items()):
        v = vm.get(name)
        if not v:
            errors.append(f"CronJob/{name}: not found in VM crontab")
            continue

        if cj.schedule != v.schedule:
            errors.append(f"CronJob/{name}: schedule mismatch (k8s={cj.schedule!r}, vm={v.schedule!r})")
        if str(cj.timeout_min) != str(v.timeout_min):
            errors.append(f"CronJob/{name}: timeout mismatch (k8s={cj.timeout_min!r}, vm={v.timeout_min!r})")

        # Script paths should point at the same job script.
        if Path(cj.script_path).name != Path(v.script_path).name:
            errors.append(
                f"CronJob/{name}: script mismatch (k8s={cj.script_path!r}, vm={v.script_path!r})"
            )

    if errors:
        for e in errors:
            print(f"ERROR: {e}")
        return 1

    print("OK: AKS pipelines CronJobs match VM crontab schedule/timeout")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
