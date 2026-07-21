const SYNTHETIC_SCENARIOS = {
  buffer:
    "For Synthetic FlashSim only, plan a fixed-size write-buffer model with synthetic hit-ratio and flush-count metrics while preserving existing workloads.",
  latency:
    "For Synthetic FlashSim only, plan deterministic synthetic latency-percentile aggregation while preserving existing workloads and result fields.",
  workload:
    "For Synthetic FlashSim only, plan one additional synthetic workload while preserving the existing workload names and deterministic behavior.",
  parameter:
    "For Synthetic FlashSim only, plan a bounded queue-depth parameter with validation, backward-compatible defaults, deterministic metrics, and regression tests.",
  generic:
    "For Synthetic FlashSim only, plan a small generic simulator extension using only the supplied synthetic repository snapshot.",
} as const;

export function toSyntheticFeatureRequest(untrustedRequest: string): string {
  if (/buffer|cache|버퍼|캐시/iu.test(untrustedRequest)) return SYNTHETIC_SCENARIOS.buffer;
  if (/latency|percentile|p99|지연/iu.test(untrustedRequest)) return SYNTHETIC_SCENARIOS.latency;
  if (/workload|워크로드/iu.test(untrustedRequest)) return SYNTHETIC_SCENARIOS.workload;
  if (/queue|depth|parameter|파라미터|큐/iu.test(untrustedRequest)) {
    return SYNTHETIC_SCENARIOS.parameter;
  }
  return SYNTHETIC_SCENARIOS.generic;
}
