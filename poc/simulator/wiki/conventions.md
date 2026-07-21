# Project conventions

- Python standard library only; no external runtime dependencies.
- Pure calculation functions should accept inputs and return immutable values.
- Synthetic configuration lives in `config/device.json`; avoid magic device constants.
- Workloads and tests must be deterministic across runs.
- Every behavior change needs a focused unit test and one regression assertion.
- Performance tests assert invariants and relative behavior, not wall-clock timing.
- CLI parsing and formatting stay in `main()`; business rules stay in testable functions.
- Names and example values must remain fictional and generic.
