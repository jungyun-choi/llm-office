import type { PocModelOutput } from "../domain/poc-schema";
import type { PocFallbackReason } from "../domain/poc-types";
import type { AgentRuntimeResult } from "../application/ports/agent-runtime";

const DEMO_MODEL = "deterministic/synthetic-flashsim-v1";

function featureLabel(prompt: string): string {
  if (/buffer|cache|버퍼|캐시/iu.test(prompt)) {
    return "write buffer 모델과 관측 지표 추가";
  }
  if (/latency|지연|percentile|p99/iu.test(prompt)) {
    return "latency 집계 기능 확장";
  }
  if (/workload|워크로드/iu.test(prompt)) {
    return "workload 모델 확장";
  }
  return "Synthetic FlashSim 기능 확장";
}

function createDemoOutput(prompt: string): PocModelOutput {
  const title = featureLabel(prompt);

  return {
    roleOutputs: [
      {
        role: "research",
        summary: "합성 Wiki와 디버깅 기록에서 변경 제약과 회귀 위험을 찾았습니다.",
        findings: [
          "시뮬레이터는 고정 workload를 immutable request 목록으로 만든 뒤 집계합니다.",
          "처리율은 합성 channel 한계를 넘지 않아야 하며 기본 실행은 결정론적이어야 합니다.",
        ],
        evidence: [
          "wiki/architecture.md: Synthetic architecture",
          "wiki/debugging-history.md: D-002 and D-003",
        ],
      },
      {
        role: "framework",
        summary: "계산 규칙은 pure function으로, CLI는 얇은 adapter로 유지하는 변경안입니다.",
        findings: [
          "새 설정은 config/device.json에 두고 simulate()에 명시적으로 전달해야 합니다.",
          "기존 네 개 결과 필드의 의미와 세 workload 이름은 호환성 경계입니다.",
        ],
        evidence: [
          "src/simulator.py: simulate",
          "wiki/architecture.md: Compatibility boundary",
          "wiki/conventions.md: Project conventions",
        ],
      },
      {
        role: "estimate",
        summary: "작은 기능이지만 집계 의미와 호환성 검증을 포함해 상대 공수 M으로 봅니다.",
        findings: [
          "데이터 모델·계산 함수 변경은 S, fixture와 회귀 테스트는 S입니다.",
          "host-acknowledged와 media throughput 의미가 섞이면 재작업 위험이 있습니다.",
        ],
        evidence: [
          "wiki/debugging-history.md: D-002",
          "tests/test_simulator.py: SimulatorTest",
        ],
      },
      {
        role: "test",
        summary: "정확한 값, 경계, 회귀, 상대 성능 불변식을 함께 검증합니다.",
        findings: [
          "기능 비활성 시 기존 mixed 결과가 동일한지 회귀 검증합니다.",
          "빈 workload, 단일 request, 용량 경계와 channel 처리율 상한을 검증합니다.",
        ],
        evidence: [
          "tests/test_simulator.py: SimulatorTest",
          "wiki/debugging-history.md: D-001",
        ],
      },
      {
        role: "git",
        summary: "구현 범위와 완료 조건을 포함한 Git 이슈 초안을 준비했습니다.",
        findings: [
          "이슈는 합성 저장소용 초안이며 실제 Git에는 등록하지 않습니다.",
          "완료 조건에 기존 workload 호환성과 결정론 보존을 포함했습니다.",
        ],
        evidence: [
          "README.md: POC 요청 예시",
          "wiki/conventions.md: Project conventions",
        ],
      },
    ],
    brief: {
      title,
      objective: `사용자 요청을 Synthetic FlashSim의 기존 계약을 보존하는 기능 변경으로 구체화합니다: ${prompt.slice(0, 240)}`,
      scope: [
        "합성 설정과 immutable 결과 모델 확장",
        "pure calculation function 구현 계획",
        "CLI JSON 결과의 하위 호환 확장",
        "단위·회귀·불변식 테스트 추가",
      ],
      outOfScope: [
        "실제 SSD/UFS 하드웨어 정확도 보장",
        "회사 저장소 또는 내부 문서 연결",
        "코드 구현과 실제 Git 이슈 등록",
      ],
      assumptions: [
        "기능은 기본값에서 비활성화하거나 기존 결과를 보존합니다.",
        "새 지표는 합성 모델의 한계를 이름과 문서에서 명확히 드러냅니다.",
      ],
      workBreakdown: [
        {
          title: "동작 계약과 지표 의미 확정",
          owner: "framework",
          effort: "S",
          dependencies: [],
        },
        {
          title: "설정·요청·결과 모델 변경안 작성",
          owner: "framework",
          effort: "S",
          dependencies: ["동작 계약과 지표 의미 확정"],
        },
        {
          title: "경계 및 회귀 테스트 매트릭스 작성",
          owner: "test",
          effort: "S",
          dependencies: ["동작 계약과 지표 의미 확정"],
        },
        {
          title: "Git 이슈 초안 검토",
          owner: "git",
          effort: "XS",
          dependencies: ["경계 및 회귀 테스트 매트릭스 작성"],
        },
      ],
      acceptanceCriteria: [
        "기존 세 workload와 네 결과 필드는 동일한 의미로 동작한다.",
        "동일 입력과 설정은 실행마다 동일한 결과를 만든다.",
        "모든 처리율 지표는 정의된 synthetic channel 상한을 위반하지 않는다.",
        "추가 지표와 모델 한계가 README 또는 Wiki에 문서화된다.",
      ],
      testStrategy: [
        "기능 비활성 기본값에 대한 golden regression test",
        "최소·최대 설정과 단일 request에 대한 boundary test",
        "read-heavy, write-heavy, mixed별 deterministic unit test",
        "처리율 상한과 지표 범위에 대한 invariant test",
      ],
      risks: [
        "host 응답과 media 완료의 의미 혼동 — 지표 이름과 문서로 구분합니다.",
        "숨은 상태로 인한 flaky test — 상태를 명시적 immutable 입력으로 전달합니다.",
      ],
      issueDraft: {
        title: `[POC] ${title}`,
        body: `## 목적\n${title}을 Synthetic FlashSim에 추가할 수 있도록 구현 계약을 준비한다.\n\n## 범위\n- 설정 및 immutable 데이터 모델 확장\n- pure calculation 변경안\n- 기존 workload 호환성 보존\n- 단위·회귀·불변식 테스트\n\n## 완료 조건\n- 기존 결과 의미가 유지된다.\n- 동일 입력은 동일 결과를 만든다.\n- synthetic channel 처리율 상한을 넘지 않는다.\n\n## 제외\n실제 장치 정확도 보장과 실제 Git 등록은 이 POC 범위가 아니다.`,
        labels: ["enhancement", "poc"],
      },
    },
  };
}

export function runDemoPoc(
  prompt: string,
  fallbackReason?: PocFallbackReason,
): AgentRuntimeResult {
  return {
    runtimeId: "deterministic",
    runtimeLabel: "안전한 데모 엔진",
    kind: "deterministic",
    dataRoute: "deterministic",
    model: DEMO_MODEL,
    output: createDemoOutput(prompt),
    fallbackReason,
    metrics: { cliProcesses: 0, modelTurns: 0, durationMs: 0 },
  };
}
