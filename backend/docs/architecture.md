# POC local agent bridge

The POC keeps hosted UI execution and local CLI execution in separate import graphs.

```text
Hosted route -> hosted controller -> deterministic runtime
Local bridge -> local controller -> PocRunService -> AgentRuntime
                                              \-> SimulatorSource
```

- `AgentRuntime` is the provider boundary. The current adapters are Codex CLI,
  optional OpenCode CLI, and deterministic fallback.
- `SimulatorSource` is the source boundary. The POC uses only
  `SyntheticSimulatorSource`; `InternalRepoSource` requires an administrator-provided
  allowlist and snapshot factory and is not wired to the external Codex adapter.
- CLI runtimes receive a bounded snapshot rather than repository credentials or
  user-selected paths. The hosted Worker never imports the local controller or
  subprocess runtime.
- One request creates at most one CLI process and one model turn. A single-flight
  coordinator reuses matching idempotent requests and rejects competing work.
- The local bridge binds to `127.0.0.1`, verifies Host, remote address, exact Origin,
  an in-memory session token, body size, and input schema before dispatch.

The POC does not modify simulator code and never publishes a Git issue. A future
internal deployment should select OpenCode plus an internal model and connect an
approved source snapshot adapter inside the company trust boundary.
