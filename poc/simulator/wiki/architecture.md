# Synthetic architecture

`src/simulator.py` follows a four-step flow:

1. `load_config()` reads a fixed synthetic device profile.
2. `build_workload()` creates a deterministic list of requests.
3. `request_latency_us()` calculates per-request latency.
4. `simulate()` aggregates latency, request count, and capped throughput.

The configuration boundary is JSON, while requests and results are immutable dataclasses.
The model intentionally ignores firmware, cache, NAND timing, garbage collection, power,
and protocol details. New features should remain deterministic and must not mutate global
state. The command-line interface is a thin adapter over these functions.

## Compatibility boundary

- Existing workload names and the four current result fields are public POC behavior.
- Additional result fields may be added, but existing fields must retain their meaning.
- Invalid workloads fail at the CLI `choices` boundary.
- Empty programmatic workloads raise `ValueError`.
