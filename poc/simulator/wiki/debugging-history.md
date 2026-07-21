# Synthetic debugging history

## D-001 — percentile index overflow

An early implementation rounded `len(values) * 0.99` upward and indexed past the final
element for small workloads. The current implementation clamps the index. Regression tests
for result determinism cover the ten-request workload; new aggregation code should add an
explicit one-request case.

## D-002 — impossible aggregate bandwidth

Summing request service rates allowed throughput to exceed the device's synthetic channel
limit. `simulate()` now caps throughput at `channels * channel_bandwidth_mib_s`. New cache
or buffering models must preserve the physical cap unless the metric is clearly named as
host-acknowledged rather than media throughput.

## D-003 — hidden global state

A prototype workload generator used a module-level random number generator, which made
tests flaky. It was replaced by fixed request patterns. Any future variability must accept
an explicit seed and retain a deterministic default.
