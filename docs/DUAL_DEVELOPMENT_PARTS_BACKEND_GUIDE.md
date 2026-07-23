# 개발 1파트·2파트 백엔드 연동 가이드

> 대상: 사내 Claude가 AI Office 백엔드를 개편할 때 사용하는 구현 인계서
>
> UI 상태: `개발 1파트(Claude)`와 `개발 2파트(OpenCode)` 배치는 구현되어 있다.
> 이 문서는 백엔드 권장안만 설명하며, 현재 커밋에는 실행기·DB·Job API 변경이 없다.

## 1. 목표

개발팀을 서로 독립적으로 일할 수 있는 두 실행 파트로 나눈다.

| 파트 | 권장 업무 | 구성 | 런타임 |
|---|---|---|---|
| 개발 1파트 | 고난도, 넓은 영향 범위, 복합 판단 | 아틀라스 + 메이슨 + 베라 + 릴레이 | Claude Opus/Sonnet/Haiku |
| 개발 2파트 | 저난도, 좁은 범위, 정형·반복 구현 | 아르고 + 코어 + 센티널 + 브릿지 | 사내 OpenCode 역할별 모델 |

분석팀이 만드는 난이도는 **추천 근거**이고, 실행 파트는 검토팀의 사람이 최종 결정한다.
두 파트는 서로 다른 Job을 동시에 처리할 수 있어야 한다. 분석 대기열이나 검토 대기열과도
각각 독립적으로 움직인다.

## 2. 핵심 설계 결정

1. 기존 `JobState`는 유지하고 `developmentPart` 필드로 실행 lane을 구분한다.
2. 난이도 평가와 사람의 파트 배정을 별도 데이터로 저장한다.
3. `approve_coding` 시 파트 배정을 함께 확정해 한 번의 Human Gate로 처리한다.
4. Claude와 OpenCode 실행기는 같은 `DevelopmentRuntime` 포트를 구현한다.
5. 테스트, 변경 digest, Commit·Push·PR, 최종 사람 검토 규칙은 두 파트가 동일하게 사용한다.
6. 마이그레이션 중 파트가 없는 기존 개발 Job은 `claude`로 해석한다.

난이도만 보고 서버가 자동으로 코딩을 시작하지 않는다. 비용 절감용 추천과 코드 변경 권한을
분리해야 기존 승인 계약과 감사 기록이 유지된다.

## 3. Job 계약

권장 타입은 다음과 같다.

```ts
type DevelopmentPart = "claude" | "opencode";
type TaskDifficultyLevel = "easy" | "normal" | "hard" | "critical";

interface DifficultyAssessment {
  level: TaskDifficultyLevel;
  score?: number; // 1~5
  confidence?: number; // 0~1
  summary: string;
  signals: string[];
  recommendedPart: DevelopmentPart;
  assessedAt: string;
  sourceAnalysisRunId: string;
}

interface DevelopmentAssignment {
  part: DevelopmentPart;
  assignedBy: "human";
  assignedAt: string;
  reason?: string;
  version: number;
}
```

Job DTO에는 UI가 이미 읽을 수 있는 다음 필드를 노출한다.

```ts
interface JobDTO {
  difficultyAssessment?: DifficultyAssessment;
  developmentPart?: DevelopmentPart;
  developmentAssignment?: DevelopmentAssignment;
}
```

프론트는 `difficultyAssessment`, `difficulty_assessment`, 단순 숫자/문자열 난이도를 모두
호환해서 읽는다. 정식 백엔드는 위 camelCase 계약 하나로 고정하는 것을 권장한다.

## 4. Human Gate와 API

가장 단순한 방법은 기존 `approve_coding` 액션에 파트를 추가하는 것이다.

```http
POST /api/v1/jobs/:jobId/actions
Content-Type: application/json

{
  "action": "approve_coding",
  "expectedVersion": 12,
  "artifactDigest": "...",
  "developmentPart": "opencode",
  "feedback": "검토팀 보충 지시 또는 개발 사전 미팅 요약"
}
```

검증 규칙:

- `awaiting_coding_approval`에서만 허용한다.
- 현재 분석 산출물 digest와 `expectedVersion`을 검증한다.
- `developmentPart`는 allowlist enum으로 검증한다.
- 배정 결과와 사람, 시각, 선택 사유를 이벤트에 남긴다.
- 같은 idempotency key 재요청은 같은 결과를 반환한다.
- 파트 배정과 `coding_queued` 전이는 한 DB transaction에서 처리한다.

기존 클라이언트 호환 기간에는 `developmentPart`가 빠진 승인 요청을 `claude`로 처리하고
deprecation 로그를 남긴다. UI에 파트 선택 버튼을 연결한 뒤 필수 필드로 승격한다.

## 5. 두 개의 독립 실행 lane

상태 enum을 `coding_queued_claude`처럼 늘리지 않는다. 기존 `coding_queued`, `coding`,
`testing`을 유지하고 worker가 `developmentPart`로 lane을 선택한다.

```text
analysis lane       research -> framework -> estimate -> test -> git -> orchestrator
review gate         difficulty 확인 -> 사람의 개발 파트 선택 + 구현 승인
claude lane         lead -> implementation -> lead review -> verification -> lead decision
opencode lane       lead -> implementation -> lead review -> verification -> lead decision
git/review gates    publish approval -> PR -> final review
```

권장 동시성:

- Claude lane: 동시 1건
- OpenCode lane: 동시 1건
- 두 lane은 서로 병렬 실행 가능
- 같은 Job은 정확히 한 lane만 소유
- 서버 재시작 시 lease가 만료된 `running` Job만 마지막 안전 checkpoint에서 재개

DB에는 최소 다음 nullable/default 필드를 추가한다.

```text
difficulty_assessment_json
development_part
development_assignment_json
development_runtime
development_stages_json
development_handoffs_json
```

기존 `CLAUDE_DEVELOPMENT_TEAM_GUIDE.md`의 stage/handoff/artifact 구조를 공통 타입으로
일반화하고, 각 레코드에 `part`와 실제 `runtime/model`을 추가한다.

## 6. 실행기 구조

런타임 분기는 service의 큰 `if` 문보다 registry가 단순하다.

```ts
interface DevelopmentRuntime {
  readonly part: DevelopmentPart;
  execute(input: DevelopmentRunInput, observer: DevelopmentObserver): Promise<DevelopmentRunResult>;
  cancel(jobId: string): Promise<void>;
}

const developmentRuntimes: Record<DevelopmentPart, DevelopmentRuntime> = {
  claude: claudeDevelopmentRuntime,
  opencode: openCodeDevelopmentRuntime,
};
```

공통 입력:

- 확정된 intake brief와 개발 사전 미팅 요약
- 분석 결과, 난이도 근거, coding packet digest
- source commit과 Job 전용 worktree
- allowed paths, acceptance criteria, 공식 test command ID
- 이전 review/rework 결과

공통 출력:

- 역할별 stage와 handoff
- 요약된 결정 근거(내부 chain-of-thought 저장 금지)
- 변경 파일과 bounded diff
- 테스트 결과
- changes digest
- blocker 또는 사람 질문

### Claude 파트

기존 `CLAUDE_DEVELOPMENT_TEAM_GUIDE.md`를 따른다. Opus가 계획·리뷰·최종 판단을 하고,
Sonnet 구현·검증, Haiku Git 역할을 담당한다.

### OpenCode 파트

구조는 동일하게 `lead -> implementation -> lead review -> verification -> lead decision -> git`로
유지한다. 정확한 사내 model ID는 코드에 고정하지 않고 환경 변수나 model registry에서 받는다.

```dotenv
AI_OFFICE_OPENCODE_DEV_LEAD_MODEL=<company-model-id>
AI_OFFICE_OPENCODE_DEV_IMPLEMENTATION_MODEL=<company-model-id>
AI_OFFICE_OPENCODE_DEV_VERIFICATION_MODEL=<company-model-id>
AI_OFFICE_OPENCODE_DEV_GIT_MODEL=<company-model-id>
```

개발용 OpenCode 실행기는 분석팀의 read-only runner를 그대로 재사용하지 않는다. Job 전용
worktree 안에서 회사가 승인한 파일·검색·수정 도구를 정상적으로 사용해야 한다. 사내 격리
환경에 외부 Zen POC용 `tools: false`, 빈 workspace, 합성 snapshot 제한을 다시 적용하지 않는다.
신뢰 workspace 설정은 `COMPANY_OPENCODE_TRUSTED_WORKSPACE_GUIDE.md`를 따른다.

## 7. capabilities와 UI 폴링

capabilities 응답에 두 런타임을 명시한다.

```json
{
  "codingRuntimes": {
    "claude": {
      "available": true,
      "label": "Claude Enterprise",
      "models": { "lead": "...", "implementation": "...", "verification": "...", "git": "..." }
    },
    "opencode": {
      "available": true,
      "label": "CodeLLMPro",
      "models": { "lead": "...", "implementation": "...", "verification": "...", "git": "..." }
    }
  }
}
```

현재 UI는 `codingRuntimes.claude/opencode`가 문자열 또는 `{ label }` 형태여도 표시할 수 있다.
역할별 실시간 진행 UI까지 연결할 때는 Job의 `developmentStages`와 `developmentHandoffs`를 기존
Job polling/SSE 갱신에 포함한다. stage 갱신은 최소 시작, heartbeat, 완료, 실패 시점에 저장한다.

## 8. 실패·질문·검증 규칙

- 팀원이 막히면 해당 파트 팀장에게 보고하고, 팀장이 해결하지 못하면 기존
  `awaiting_development_input` Human Gate로 올린다.
- UI와 API의 질문에는 `developmentPart`, `raisedBy`, `resumeStage`를 함께 넣는다.
- OpenCode 실패가 Claude lane의 Job을 멈추게 해서는 안 되고 반대도 동일하다.
- 두 파트 모두 Job worktree 밖 수정, 허용 경로 밖 diff, digest 불일치 시 실패 처리한다.
- 공식 테스트 실행과 Git 게시 권한은 모델 출력이 아니라 서버 정책이 결정한다.
- Commit·Push·PR은 기존 사람 승인 뒤에 정확히 한 번만 실행한다.
- 로그에는 prompt 전문이나 secret을 남기지 말고 Job ID, part, role, model, duration, status만 남긴다.

## 9. 권장 구현 순서

1. DB/DTO에 난이도와 파트 필드를 추가하고 기존 Job 호환 테스트를 작성한다.
2. `approve_coding`에 원자적 파트 배정을 추가한다.
3. 기존 Claude 실행기를 `DevelopmentRuntime` 어댑터로 감싼다.
4. OpenCode 개발 runtime을 Job 전용 worktree 기반으로 구현한다.
5. part별 worker lease와 독립 동시성 제한을 추가한다.
6. capabilities와 Job stage/handoff 응답을 연결한다.
7. 검토 데스크 UI의 파트 선택 control을 실제 API에 연결한다.
8. 장애·재시작·재시도·중복 승인·중복 PR 회귀 테스트를 통과시킨다.

## 10. 완료 조건

- 쉬운 업무를 개발 2파트에 승인하면 OpenCode만 실행된다.
- 어려운 업무를 개발 1파트에 승인하면 Claude만 실행된다.
- 두 파트가 서로 다른 Job을 동시에 처리한다.
- 파트 미지정·중복 소유·digest 불일치 Job은 실행되지 않는다.
- 각 역할의 진행, 산출물, blocker가 Job API에 보이고 서버 재시작 후 복구된다.
- 두 파트 모두 테스트·Git·최종 PR Human Gate를 우회하지 않는다.
- 기존 파트 없는 Job과 기존 클라이언트가 마이그레이션 기간 동안 정상 동작한다.
