"""A deliberately small and deterministic synthetic flash simulator."""

from __future__ import annotations

import argparse
import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Request:
    operation: str
    size_kib: int
    queue_depth: int


@dataclass(frozen=True)
class SimulationResult:
    average_latency_us: float
    p99_latency_us: float
    throughput_mib_s: float
    request_count: int


def load_config() -> dict[str, int]:
    config_path = Path(__file__).parents[1] / "config" / "device.json"
    return json.loads(config_path.read_text(encoding="utf-8"))


def build_workload(name: str) -> list[Request]:
    mixes = {
        "read-heavy": (7, 3),
        "write-heavy": (3, 7),
        "mixed": (5, 5),
    }
    reads, writes = mixes[name]
    requests = [Request("read", 16, index % 4 + 1) for index in range(reads)]
    requests.extend(Request("write", 16, index % 4 + 1) for index in range(writes))
    return requests


def request_latency_us(request: Request, config: dict[str, int]) -> float:
    latency_key = f"{request.operation}_base_latency_us"
    queue_cost = max(0, request.queue_depth - 1) * config["queue_penalty_us"]
    return float(config[latency_key] + queue_cost)


def simulate(requests: list[Request], config: dict[str, int]) -> SimulationResult:
    if not requests:
        raise ValueError("workload must contain at least one request")

    latencies = sorted(request_latency_us(request, config) for request in requests)
    average = sum(latencies) / len(latencies)
    p99_index = min(len(latencies) - 1, int(len(latencies) * 0.99))
    total_mib = sum(request.size_kib for request in requests) / 1024
    elapsed_seconds = sum(latencies) / 1_000_000
    device_limit = config["channels"] * config["channel_bandwidth_mib_s"]
    throughput = min(total_mib / elapsed_seconds, device_limit)
    return SimulationResult(average, latencies[p99_index], throughput, len(requests))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--workload",
        choices=("read-heavy", "write-heavy", "mixed"),
        default="mixed",
    )
    args = parser.parse_args()
    result = simulate(build_workload(args.workload), load_config())
    print(json.dumps(result.__dict__, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
