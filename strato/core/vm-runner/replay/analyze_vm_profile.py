#!/usr/bin/env python3
"""Summarize VM_PROFILE_PHASES JSONL without third-party dependencies."""

from __future__ import annotations

import argparse
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from statistics import median
from typing import Iterable


def nearest_rank(values: Iterable[int], probability: float) -> int:
    ordered = sorted(values)
    if not ordered:
        return 0
    index = max(0, min(len(ordered) - 1, math.ceil(probability * len(ordered)) - 1))
    return ordered[index]


def read_profile(path: Path) -> tuple[list[dict], dict | None]:
    blocks = []
    summary = None
    with path.open(encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, 1):
            if not line.strip():
                continue
            try:
                value = json.loads(line)
            except json.JSONDecodeError as exc:
                raise SystemExit(f"{path}:{line_number}: invalid JSON: {exc}") from exc
            if value.get("type") == "block":
                blocks.append(value)
            elif value.get("type") == "summary":
                summary = value
    if not blocks:
        raise SystemExit(f"{path}: no block records")
    return blocks, summary


def ms(nanoseconds: int) -> str:
    return f"{nanoseconds / 1_000_000:.3f}"


def mib(byte_count: int) -> str:
    return f"{byte_count / (1024 * 1024):.2f}"


def print_profile(path: Path, blocks: list[dict], summary: dict | None, outlier_count: int) -> None:
    totals = [block["wall_ns"] for block in blocks]
    total_wall = sum(totals)
    phases = list(blocks[0]["phase_wall_ns"])
    active_phases = [
        phase
        for phase in phases
        if any(
            block["phase_wall_ns"][phase] or block["phase_counts"][phase]
            for block in blocks
        )
    ]
    run_code_detail = bool(summary and summary.get("run_code_detail_enabled"))

    def display_phase(phase: str) -> str:
        if not run_code_detail and phase.endswith(".wrapper_residual"):
            return phase.removesuffix(".wrapper_residual") + ".total"
        return phase
    block_numbers = [block["block"] for block in blocks]
    tx_count = sum(block["transactions"] for block in blocks)

    print(f"\n## {path}")
    print(
        f"\nBlocks {len(blocks):,} (#{min(block_numbers):,}-#{max(block_numbers):,}), "
        f"transactions {tx_count:,}, wall {total_wall / 1e9:.3f}s, "
        f"median {ms(nearest_rank(totals, 0.5))} ms/block."
    )
    print(
        "Total block wall distribution: "
        f"p50 {ms(nearest_rank(totals, 0.50))} ms, "
        f"p90 {ms(nearest_rank(totals, 0.90))} ms, "
        f"p99 {ms(nearest_rank(totals, 0.99))} ms, max {ms(max(totals))} ms; "
        f"CPU {sum(block['cpu_ns'] for block in blocks) / 1e9:.3f}s; "
        f"allocations {mib(sum(block['allocated_bytes'] for block in blocks))} MiB."
    )
    print("\n| Exclusive phase | wall s | wall % | p50 ms | p90 ms | p99 ms | max ms | CPU s | alloc MiB | spans |")
    print("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for phase in active_phases:
        wall = [block["phase_wall_ns"][phase] for block in blocks]
        cpu = [block["phase_cpu_ns"][phase] for block in blocks]
        allocations = [block["phase_allocated_bytes"][phase] for block in blocks]
        spans = sum(block["phase_counts"][phase] for block in blocks)
        wall_sum = sum(wall)
        print(
            f"| {display_phase(phase)} | {wall_sum / 1e9:.3f} | {100 * wall_sum / total_wall:.2f} | "
            f"{ms(nearest_rank(wall, 0.5))} | {ms(nearest_rank(wall, 0.9))} | "
            f"{ms(nearest_rank(wall, 0.99))} | {ms(max(wall))} | {sum(cpu) / 1e9:.3f} | "
            f"{mib(sum(allocations))} | {spans:,} |"
        )

    residual_wall = [block["unattributed_residual"]["wall_ns"] for block in blocks]
    residual_cpu = [block["unattributed_residual"]["cpu_ns"] for block in blocks]
    residual_alloc = [block["unattributed_residual"]["allocated_bytes"] for block in blocks]
    residual_sum = sum(residual_wall)
    print(
        f"| unattributed_residual | {residual_sum / 1e9:.3f} | {100 * residual_sum / total_wall:.2f} | "
        f"{ms(nearest_rank(residual_wall, 0.5))} | {ms(nearest_rank(residual_wall, 0.9))} | "
        f"{ms(nearest_rank(residual_wall, 0.99))} | {ms(max(residual_wall))} | "
        f"{sum(residual_cpu) / 1e9:.3f} | {mib(sum(residual_alloc))} | 0 |"
    )

    wall_errors = [abs(block["reconciliation"]["wall_error_ns"]) for block in blocks]
    cpu_errors = [abs(block["reconciliation"]["cpu_error_ns"]) for block in blocks]
    allocation_errors = [abs(block["reconciliation"]["allocated_bytes_error"]) for block in blocks]
    print(
        "\nReconciliation max absolute error: "
        f"wall {max(wall_errors):,} ns, CPU {max(cpu_errors):,} ns, "
        f"allocations {max(allocation_errors):,} bytes; "
        f"unattributed wall {100 * residual_sum / total_wall:.3f}%."
    )

    run_code_groups = {
        "call": [phase for phase in phases if phase.startswith("04_run_code.call.")],
        "creation": [phase for phase in phases if phase.startswith("04_run_code.creation.")],
    }
    if any(run_code_groups.values()):
        print("\n### Reconciled runCodeForTransaction hierarchy")
        print("\n| transaction kind | wall s | wall % | p50 ms/block | p90 | p99 | max |")
        print("|---|---:|---:|---:|---:|---:|---:|")
        for kind, group_phases in run_code_groups.items():
            if not group_phases:
                continue
            wall = [
                sum(block["phase_wall_ns"][phase] for phase in group_phases)
                for block in blocks
            ]
            wall_sum = sum(wall)
            print(
                f"| {kind} | {wall_sum / 1e9:.3f} | {100 * wall_sum / total_wall:.2f} | "
                f"{ms(nearest_rank(wall, 0.50))} | {ms(nearest_rank(wall, 0.90))} | "
                f"{ms(nearest_rank(wall, 0.99))} | {ms(max(wall))} |"
            )

        if run_code_detail:
            print("\n### SolidVM code-collection cache")
            print("\n| transaction kind | lookups | hits | cold misses | hit rate | cold wall s | cold max ms/block |")
            print("|---|---:|---:|---:|---:|---:|---:|")
            for kind in run_code_groups:
                lookup_phase = f"04_run_code.{kind}.code_cache_lookup"
                refined_miss_phase = f"04_run_code.{kind}.cold_parse_import_collection"
                legacy_cold_phase = f"04_run_code.{kind}.cold_code_load_compile_typecheck"
                if refined_miss_phase in phases:
                    miss_phase = refined_miss_phase
                    cold_phases = [
                        phase
                        for phase in phases
                        if phase.startswith(f"04_run_code.{kind}.cold_")
                    ]
                elif legacy_cold_phase in phases:
                    miss_phase = legacy_cold_phase
                    cold_phases = [legacy_cold_phase]
                else:
                    continue
                if lookup_phase not in phases:
                    continue
                lookups = sum(block["phase_counts"][lookup_phase] for block in blocks)
                cold_misses = sum(block["phase_counts"][miss_phase] for block in blocks)
                hits = max(0, lookups - cold_misses)
                cold_wall = [
                    sum(block["phase_wall_ns"][phase] for phase in cold_phases)
                    for block in blocks
                ]
                hit_rate = 100 * hits / lookups if lookups else 0.0
                print(
                    f"| {kind} | {lookups:,} | {hits:,} | {cold_misses:,} | {hit_rate:.2f}% | "
                    f"{sum(cold_wall) / 1e9:.3f} | {ms(max(cold_wall))} |"
                )

            detailed_groups = {
                "Statement: interpreter/expression residual": [
                    "statement_interpreter_expression_residual"
                ],
                "Statement: storage reads": ["statement_storage_read"],
                "Statement: storage writes": ["statement_storage_write"],
                "Statement: cryptographic builtins": ["statement_crypto_builtin"],
                "Statement: other builtins": ["statement_other_builtin"],
                "Cold: code database I/O": ["cold_code_database_io"],
                "Cold: parse/import/collection": ["cold_parse_import_collection"],
                "Cold: inheritance/typecheck/optimizer": [
                    "cold_inheritance_typecheck_optimize"
                ],
                "Cold: final function inheritance": ["cold_function_inheritance"],
                "Cold: wrapper/cache residual": ["cold_code_residual"],
            }
            detailed_phase_groups = {
                label: [
                    f"04_run_code.{kind}.{suffix}"
                    for kind in ("call", "creation")
                    for suffix in suffixes
                    if f"04_run_code.{kind}.{suffix}" in phases
                ]
                for label, suffixes in detailed_groups.items()
            }
            detailed_phase_groups = {
                label: group
                for label, group in detailed_phase_groups.items()
                if group
            }
            if detailed_phase_groups:
                run_code_wall = sum(
                    block["phase_wall_ns"][phase]
                    for block in blocks
                    for phase in phases
                    if phase.startswith("04_run_code.")
                )
                print("\n### Statement and cold-path subdivision")
                print(
                    "\n| exclusive subdivision | wall s | full-block % | runCode % | invocations |"
                )
                print("|---|---:|---:|---:|---:|")
                for label, group in detailed_phase_groups.items():
                    wall = sum(
                        block["phase_wall_ns"][phase]
                        for block in blocks
                        for phase in group
                    )
                    invocations = sum(
                        block["phase_counts"][phase]
                        for block in blocks
                        for phase in group
                    )
                    print(
                        f"| {label} | {wall / 1e9:.3f} | "
                        f"{100 * wall / total_wall:.2f} | "
                        f"{100 * wall / run_code_wall if run_code_wall else 0:.2f} | "
                        f"{invocations:,} |"
                    )

    if summary and summary.get("phase_spans_enabled"):
        print("\n### Per-invocation phase latency")
        print("\n| Exclusive phase | spans | p50 ms | p90 ms | p99 ms | max ms | CPU p99 ms | alloc p99 MiB |")
        print("|---|---:|---:|---:|---:|---:|---:|---:|")
        for phase in active_phases:
            distribution = summary["phase_spans"][phase]
            wall = distribution["wall_ns"]
            cpu = distribution["cpu_ns"]
            allocations = distribution["allocated_bytes"]
            print(
                f"| {display_phase(phase)} | {distribution['span_count']:,} | {ms(wall['p50'])} | "
                f"{ms(wall['p90'])} | {ms(wall['p99'])} | {ms(wall['max'])} | "
                f"{ms(cpu['p99'])} | {mib(allocations['p99'])} |"
            )

    print("\n### Slowest blocks")
    print("\n| block | txs | wall ms | CPU ms | alloc MiB | dominant exclusive phase | phase ms | accounts | storage keys |")
    print("|---:|---:|---:|---:|---:|---|---:|---:|---:|")
    slowest = sorted(blocks, key=lambda block: block["wall_ns"], reverse=True)[:outlier_count]
    for block in slowest:
        dominant = max(block["phase_wall_ns"], key=block["phase_wall_ns"].get)
        print(
            f"| {block['block']} | {block['transactions']} | {ms(block['wall_ns'])} | "
            f"{ms(block['cpu_ns'])} | {mib(block['allocated_bytes'])} | {display_phase(dominant)} | "
            f"{ms(block['phase_wall_ns'][dominant])} | {block['accounts_touched']} | "
            f"{block['storage_keys_touched']} |"
        )

    db = Counter()
    for block in blocks:
        db.update(block["db"])
    print("\n### Counters")
    print("\n| metric | total | per block |")
    print("|---|---:|---:|")
    for name, value in sorted(db.items()):
        print(f"| {name} | {value:,} | {value / len(blocks):.3f} |")
    print(
        f"\nAccounts touched sum {sum(block['accounts_touched'] for block in blocks):,}; "
        f"storage keys touched sum {sum(block['storage_keys_touched'] for block in blocks):,}."
    )
    if summary and summary.get("output_hashes"):
        print("\n### Output payload hashes")
        print("\n| topic | SHA-256 | messages | bytes |")
        print("|---|---|---:|---:|")
        for topic, value in sorted(summary["output_hashes"].items()):
            print(f"| {topic} | `{value['sha256']}` | {value['messages']:,} | {value['bytes']:,} |")


def print_across_runs(
    profiles: list[tuple[Path, list[dict], dict | None]], outlier_count: int
) -> None:
    print("\n## Across-run aggregate")
    print("\n| run | block wall s | CPU s | p50 ms | p90 ms | p99 ms | max ms |")
    print("|---|---:|---:|---:|---:|---:|---:|")
    for path, blocks, _ in profiles:
        walls = [block["wall_ns"] for block in blocks]
        print(
            f"| {path.name} | {sum(walls) / 1e9:.3f} | "
            f"{sum(block['cpu_ns'] for block in blocks) / 1e9:.3f} | "
            f"{ms(nearest_rank(walls, 0.50))} | {ms(nearest_rank(walls, 0.90))} | "
            f"{ms(nearest_rank(walls, 0.99))} | {ms(max(walls))} |"
        )

    phases = list(profiles[0][1][0]["phase_wall_ns"])
    all_blocks = [block for _, blocks, _ in profiles for block in blocks]
    total_wall = sum(block["wall_ns"] for block in all_blocks)
    active_phases = [
        phase
        for phase in phases
        if any(block["phase_wall_ns"][phase] for block in all_blocks)
    ]
    print("\n### Reconciled phase aggregate")
    print("\n| Exclusive phase | combined wall s | combined wall % | run-share range | p50 ms | p90 ms | p99 ms | max ms | CPU s | alloc MiB |")
    print("|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|")
    for phase in active_phases:
        walls = [block["phase_wall_ns"][phase] for block in all_blocks]
        wall_sum = sum(walls)
        run_shares = []
        for _, blocks, _ in profiles:
            run_total = sum(block["wall_ns"] for block in blocks)
            run_phase = sum(block["phase_wall_ns"][phase] for block in blocks)
            run_shares.append(100 * run_phase / run_total)
        label = phase
        if phase.endswith(".wrapper_residual"):
            label = phase.removesuffix(".wrapper_residual") + ".total"
        print(
            f"| {label} | {wall_sum / 1e9:.3f} | {100 * wall_sum / total_wall:.2f} | "
            f"{min(run_shares):.2f}-{max(run_shares):.2f}% | "
            f"{ms(nearest_rank(walls, 0.50))} | {ms(nearest_rank(walls, 0.90))} | "
            f"{ms(nearest_rank(walls, 0.99))} | {ms(max(walls))} | "
            f"{sum(block['phase_cpu_ns'][phase] for block in all_blocks) / 1e9:.3f} | "
            f"{mib(sum(block['phase_allocated_bytes'][phase] for block in all_blocks))} |"
        )

    residuals = [block["unattributed_residual"]["wall_ns"] for block in all_blocks]
    print(
        f"\nCombined unattributed wall: {sum(residuals) / 1e9:.3f}s "
        f"({100 * sum(residuals) / total_wall:.3f}%). "
        "Maximum reconciliation error across all runs: "
        f"wall {max(abs(block['reconciliation']['wall_error_ns']) for block in all_blocks):,} ns, "
        f"CPU {max(abs(block['reconciliation']['cpu_error_ns']) for block in all_blocks):,} ns, "
        f"allocations {max(abs(block['reconciliation']['allocated_bytes_error']) for block in all_blocks):,} bytes."
    )

    by_number: defaultdict[int, list[dict]] = defaultdict(list)
    top_sets = []
    for _, blocks, _ in profiles:
        top_sets.append(
            {
                block["block"]
                for block in sorted(blocks, key=lambda value: value["wall_ns"], reverse=True)[
                    : max(outlier_count, 50)
                ]
            }
        )
        for block in blocks:
            by_number[block["block"]].append(block)

    ranked = sorted(
        by_number.items(),
        key=lambda item: median(block["wall_ns"] for block in item[1]),
        reverse=True,
    )[:outlier_count]
    print("\n### Repeatable slow blocks")
    print("\n| block | median wall ms | wall range ms | median CPU ms | dominant median phase | phase median ms | top-50 appearances | txs |")
    print("|---:|---:|---:|---:|---|---:|---:|---:|")
    for block_number, records in ranked:
        phase_medians = {
            phase: median(record["phase_wall_ns"][phase] for record in records)
            for phase in phases
        }
        dominant = max(phase_medians, key=phase_medians.get)
        label = dominant
        if dominant.endswith(".wrapper_residual"):
            label = dominant.removesuffix(".wrapper_residual") + ".total"
        walls = [record["wall_ns"] for record in records]
        print(
            f"| {block_number} | {median(walls) / 1e6:.3f} | "
            f"{min(walls) / 1e6:.3f}-{max(walls) / 1e6:.3f} | "
            f"{median(record['cpu_ns'] for record in records) / 1e6:.3f} | {label} | "
            f"{phase_medians[dominant] / 1e6:.3f} | "
            f"{sum(block_number in top for top in top_sets)}/{len(top_sets)} | "
            f"{records[0]['transactions']} |"
        )

    output_hashes = [summary.get("output_hashes", {}) for _, _, summary in profiles if summary]
    if output_hashes:
        print(
            "\nOutput payload hashes identical across runs: "
            f"{'yes' if all(value == output_hashes[0] for value in output_hashes[1:]) else 'no'}."
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("profiles", nargs="+", type=Path)
    parser.add_argument("--outliers", type=int, default=20)
    args = parser.parse_args()
    run_medians = []
    profile_data = []
    for path in args.profiles:
        blocks, summary = read_profile(path)
        print_profile(path, blocks, summary, args.outliers)
        run_medians.append(median(block["wall_ns"] for block in blocks))
        profile_data.append((path, blocks, summary))
    if len(run_medians) > 1:
        print("\n## Across-run block-wall medians")
        for path, value in zip(args.profiles, run_medians):
            print(f"\n- {path}: {value / 1_000_000:.3f} ms")
        print(f"\nMedian of run medians: {median(run_medians) / 1_000_000:.3f} ms")
        print_across_runs(profile_data, args.outliers)


if __name__ == "__main__":
    main()
