# Claude 개발팀 다중 에이전트 연동 가이드

> 목표: Louvre 개발팀을 `Opus 팀장 + Sonnet 구현 + Sonnet 검증 + Haiku Git` 구조로
> 실행하고, 지시·보고·재작업 흐름을 기존 Job API와 UI에 실시간 표시한다.

이 문서는 백엔드 구현 지시서다. UI는 이 역할 구성을 먼저 표시하도록 구현되어 있으며,
백엔드는 아래 계약을 추가해 실제 모델 실행 상태와 산출물을 공급해야 한다.

## 1. 현재 구현과 차이

현재 `LocalJobExecutor.runCoding()`은 Claude CLI를 한 번 호출해 구현 전체를 맡긴다.

- 모델 하나만 사용한다.
- `Task`, `Agent`를 차단한다.
- Claude 실행이 끝난 뒤 서버가 별도로 테스트한다.
- Git Commit·Push·PR은 서버 publisher가 처리한다.
- UI에는 팀장·구현·검증·Git 좌석이 있지만 실제 역할별 모델 실행 기록은 없다.

따라서 현재 화면은 개발 단계를 보여 주는 UI이고, 실제 다중 에이전트 팀은 아직 아니다.

## 2. 목표 팀 구성

| 역할 | UI 이름 | 기본 모델 등급 | 책임 | 코드 쓰기 |
|---|---|---|---|---|
| `lead` | 아틀라스 | Opus | 계획, 업무 분배, Diff 리뷰, 막힘 해결, 최종 판단 | 원칙적으로 읽기 전용 |
| `implementation` | 메이슨 | Sonnet | 코드·테스트 구현, 막힘 보고, 재작업 | 허용 |
| `verification` | 베라 | Sonnet | 독립 코드 리뷰, 테스트, 회귀 위험 검증 | 테스트 보강만 선택적으로 허용 |
| `git` | 릴레이 | Haiku | 승인된 변경의 Commit·Push·PR | Git 승인 후에만 허용 |

UI 이름은 사람이 팀의 흐름을 빠르게 구분하기 위한 호출명이다. API와 저장소에서는 안정적인
role ID(`lead`, `implementation`, `verification`, `git`)를 사용한다.

모델 ID는 코드에 고정하지 않는다. 회사 model catalog의 정확한 ID를 환경 변수로 받는다.

```dotenv
AI_OFFICE_CLAUDE_LEAD_MODEL=<company-opus-model-id>
AI_OFFICE_CLAUDE_IMPLEMENTATION_MODEL=<company-sonnet-model-id>
AI_OFFICE_CLAUDE_VERIFICATION_MODEL=<company-sonnet-model-id>
AI_OFFICE_CLAUDE_GIT_MODEL=<company-haiku-model-id>
```

capabilities API는 각 역할의 표시 이름과 실제 선택된 model ID를 반환한다. 브라우저가 임의
모델 문자열을 실행 요청에 넣지 않으며, 서버 설정이 역할별 모델을 결정한다.

## 3. 권장 실행 구조

한 Opus CLI 프로세스 안에서 native sub-agent를 전부 실행하는 방식보다 **역할별 독립
프로세스 + 서버 상태 머신**을 권장한다.

```text
Human Gate 1: 아틀라스 개발 사전 미팅 + 구현 승인
  -> lead_questions(Opus): 분석 패킷의 빈칸을 최대 3개 질문
  -> 사람 답변을 짧은 development brief로 확정
  -> lead_plan(Opus)
  -> implementation(Sonnet)
  -> lead_code_review(Opus)
  -> verification(Sonnet)
  -> lead_decision(Opus)
       -> rework: implementation으로 복귀
       -> pass: Human Gate 2로 이동
  -> Human Gate 2: Git 승인
  -> git(Haiku): Commit·Push·PR
  -> Human Gate 3: 최종 PR 검토
```

Opus가 반환한 `nextAction`을 서버가 해석해 다음 담당자를 호출한다. 개념적으로 Opus가 팀원을
지휘하지만, 프로세스 생명주기와 상태 저장은 서버가 담당한다.

### 3.1 아틀라스 개발 사전 미팅

분석팀이 coding packet을 완성했다고 바로 코딩하지 않는다. Job이
`awaiting_coding_approval`에 도착하면 사용자가 분석 패킷을 읽고 아틀라스와 한 번 더 짧게
회의한다.

아틀라스는 다음 입력을 읽는다.

- 확정된 Orbit intake brief
- 분석팀 role outputs와 최종 brief
- allowed paths와 source commit
- 분석팀이 남긴 assumptions, unresolved risks, test expectations

그 뒤 구현 결과에 가장 큰 영향을 주는 빈칸만 최대 3개 질문한다. 이미 패킷에 답이 있는
내용을 다시 묻지 않으며, 질문이 필요 없으면 빈 배열을 반환할 수 있다.

권장 API:

```http
POST /api/v1/jobs/:jobId/development-meeting/questions
Content-Type: application/json

{ "expectedVersion": 12, "artifactDigest": "..." }
```

```ts
interface DevelopmentMeetingQuestionOutput {
  source: "company-claude";
  model: string;
  questions: Array<{
    id: "packet_gap" | "boundaries" | "acceptance";
    prompt: string;
    hint: string;
    placeholder: string;
  }>;
}
```

- `awaiting_coding_approval` 상태에서만 허용한다.
- artifact digest와 expected version을 검증한다.
- 응답을 그대로 권한이나 명령으로 취급하지 않고 길이와 schema를 검증한다.
- UI는 endpoint가 아직 없거나 실패하면 현재의 패킷 기반 기본 질문으로 회의를 계속한다.
- 사람 답변은 생각 과정을 저장하지 않고 4,000자 이하 `developmentBrief`로 압축한다.

구현 승인 요청은 다음처럼 brief를 함께 받는다.

```json
{
  "action": "approve_coding",
  "expectedVersion": 12,
  "artifactDigest": "...",
  "feedback": "[아틀라스 개발 사전 미팅]\n목표: ...\n구현 경계: ..."
}
```

현재 코드에서는 하위 호환을 위해 이 값을 기존 `reviewFeedback` 저장 필드와 Claude prompt에
전달한다. company 다중 에이전트 구현 시에는 명시적인 `developmentBrief`로 승격하고
`lead_plan`의 필수 입력으로 사용한다. 회의를 생략한 기존 클라이언트의 `feedback` 없는 승인도
계속 허용한다.

이 방식의 장점:

- UI가 현재 일하는 담당자와 모델을 정확히 표시할 수 있다.
- 역할별 timeout, retry, 취소를 독립적으로 처리할 수 있다.
- 서버 재시작 후 마지막 완료 단계부터 복구할 수 있다.
- Opus가 팀원을 호출했다고 말만 하고 실제 호출하지 않는 상태를 막을 수 있다.
- 구현 담당과 검증 담당의 산출물을 분리해 보관할 수 있다.

회사 Claude 런타임이 native sub-agent 호출만 지원한다면 사용할 수 있다. 단, sub-agent 이벤트를
서버가 받아 `developmentStages`와 `developmentHandoffs`로 변환할 수 있어야 한다. 최종 결과만
받는 단일 프로세스 방식은 UI 관찰성이 떨어지므로 사용하지 않는다.

## 4. Job 상태와 개발 단계

기존 top-level `JobState`는 하위 호환을 위해 유지한다.

| 기존 JobState | 내부 개발 단계 |
|---|---|
| `coding_queued` | Opus 계획 대기 |
| `coding` | Opus 계획, Sonnet 구현, Opus 코드 리뷰 |
| `testing` | Sonnet 검증, Opus 최종 판단 |
| `changes_ready` | Human Gate 2 대기 |
| `publishing` | Haiku Git 실행 |
| `review_pending` | Human Gate 3 대기 |

세부 상태는 JobRecord의 새 배열로 저장한다.

```ts
export type DevelopmentRole =
  | "lead"
  | "implementation"
  | "verification"
  | "git";

export type DevelopmentStageId =
  | "lead_plan"
  | "implementation"
  | "lead_code_review"
  | "verification"
  | "lead_decision"
  | "git";

export type DevelopmentStageStatus =
  | "pending"
  | "running"
  | "waiting"
  | "completed"
  | "failed";

export interface DevelopmentStage {
  id: DevelopmentStageId;
  role: DevelopmentRole;
  model: string;
  status: DevelopmentStageStatus;
  attempt: number;
  startedAt?: string;
  updatedAt?: string;
  completedAt?: string;
  summary?: string;
  artifactId?: string;
}

export interface DevelopmentHandoff {
  id: string;
  from: DevelopmentRole | "human";
  to: DevelopmentRole | "human";
  kind: "directive" | "result" | "blocker" | "feedback" | "approval";
  message: string;
  createdAt: string;
  round: number;
}
```

SQLite에는 최소 다음 JSON column을 추가한다.

```text
development_stages_json
development_handoffs_json
development_artifacts_json
development_round
```

기존 DB migration 방식에 맞춰 nullable/default `[]`로 추가한다. 기존 Job은 빈 배열로 읽혀야
하며 서버 시작 시 실패하지 않아야 한다.

## 5. 역할별 산출물 계약

모든 모델 출력은 JSON schema로 검증한다. 내부 사고 과정은 저장하지 않고, 결정과 근거만
저장한다.

### 5.1 Opus 계획

```ts
interface LeadPlanOutput {
  decision: "delegate_implementation" | "request_human_context";
  objective: string;
  implementationOrder: string[];
  targetFiles: string[];
  acceptanceCriteria: string[];
  testExpectations: string[];
  risks: string[];
  directive: string;
}
```

입력:

- 사용자 확정 intake brief
- OpenCode 분석 packet
- 실제 worktree와 base SHA
- 현재 review round

### 5.2 Sonnet 구현

```ts
interface ImplementationOutput {
  status: "completed" | "blocked";
  summary: string;
  changedFiles: string[];
  testsAddedOrChanged: string[];
  decisions: string[];
  blocker?: {
    summary: string;
    evidence: string[];
    attempted: string[];
    needsDirectionOn: string[];
  };
}
```

구현 담당은 업무 전용 worktree에서 작업한다. 막히면 추측으로 계속 진행하지 않고 blocker를
Opus에게 반환한다.

### 5.3 Opus 코드 리뷰와 방향 제시

```ts
interface LeadReviewOutput {
  decision: "send_to_verification" | "rework" | "human_escalation";
  summary: string;
  findings: string[];
  directive: string;
  acceptanceCriteriaDelta: string[];
}
```

Opus는 구현 결과와 실제 Diff를 읽는다. `rework`이면 Sonnet 구현 담당에게 구체적인 수정 지시를
전달한다.

### 5.4 Sonnet 검증

```ts
interface VerificationOutput {
  decision: "pass" | "rework" | "blocked";
  summary: string;
  reviewFindings: Array<{
    severity: "blocker" | "major" | "minor";
    file?: string;
    message: string;
  }>;
  testsRun: Array<{
    commandId: string;
    passed: boolean;
    summary: string;
  }>;
  regressionRisks: string[];
  blocker?: ImplementationOutput["blocker"];
}
```

검증 담당은 구현 담당의 자기평가를 신뢰하지 않고 실제 Diff와 테스트 결과를 다시 확인한다.
회사의 공식 테스트 command는 서버 registry가 결정한다. 모델이 임의 shell 문자열을 최종
승인 명령으로 만들지 않는다.

### 5.5 Opus 최종 판단

```ts
interface LeadDecisionOutput {
  decision: "ready_for_human_git_review" | "rework" | "human_escalation";
  summary: string;
  directive?: string;
  changedFileSummary: string[];
  verificationSummary: string[];
  knownRisks: string[];
}
```

`ready_for_human_git_review`일 때만 Job을 `changes_ready`로 바꾼다.

### 5.6 Haiku Git

Haiku는 Human Gate 2 승인 뒤에만 실행한다.

```ts
interface GitAgentOutput {
  commitMessage: string;
  pullRequestTitle: string;
  pullRequestBody: string;
  changedFileSummary: string[];
  issueLinks: string[];
}
```

권장 순서:

1. Haiku가 commit message와 PR 내용을 작성한다.
2. 승인된 Git tool 또는 서버 publisher가 Commit·Push·PR을 수행한다.
3. 서버가 실제 commit SHA, branch, remote, PR URL을 검증한다.
4. 검증된 값만 JobRecord에 저장한다.

Haiku에게 main 직접 Push, force-push, merge, branch 삭제 권한을 주지 않는다. 최종 merge는
Human Gate 3 승인 뒤 서버가 수행한다.

## 6. 막힘 보고와 재지시

팀원이 막히면 실패로 즉시 종료하지 않고 다음 handoff를 생성한다.

```text
Sonnet/Haiku -> Opus
kind: blocker
message: 짧은 막힘 요약
artifact: evidence, attempted, needsDirectionOn
```

Opus 응답:

```text
Opus -> 담당 팀원
kind: directive
message: 다음 행동과 완료 조건
```

자동 재작업 횟수는 기본 2회로 제한한다.

```dotenv
AI_OFFICE_CLAUDE_MAX_REWORK_ROUNDS=2
```

한도를 넘거나 Opus가 `human_escalation`을 반환하면 Job을 무한 반복하지 않는다. UI에 문제
발생 좌석, 마지막 blocker, Opus 판단을 표시하고 사람 입력을 기다린다.

## 7. 회사 런타임 권한 원칙

`company`는 사내 모델과 사내 에이전트가 이미 격리된 회사 환경에서 실행된다. 합성 POC의
도구 제한을 그대로 복사하지 않는다.

- Opus: 저장소 읽기, 코드 검색, Diff, Git history 조사
- Sonnet 구현: 회사 worktree에서 필요한 코드·테스트 수정과 승인된 명령 실행
- Sonnet 검증: Diff 읽기, 테스트 실행, 로그 확인, 필요 시 테스트 보강
- Haiku Git: Human Gate 2 뒤 승인된 branch의 Git/PR 작업

AI Office는 실제 회사 Claude 실행 환경을 사용하고, 모든 도구를 일괄 차단하지 않는다. 대신
사람 승인 시점과 역할 책임을 상태 머신으로 통제한다.

Zen/외부 POC 경로는 기존 제한을 유지한다. `company` 실패를 외부 모델로 fallback하지 않는다.

## 8. 실행기 구조

기존 `JobExecutionPort`를 단일 `runCoding()`에 계속 맞추지 말고 company용 팀 runtime을
추가한다.

권장 파일:

```text
lib/office-jobs/application/claude-team-runtime.ts
lib/office-jobs/application/claude-team-contract.ts
lib/office-jobs/infrastructure/company-claude-turn-executor.ts
lib/office-jobs/infrastructure/company-claude-team-executor.ts
lib/office-jobs/infrastructure/claude-team-prompt-loader.ts
poc/company-claude-prompts/lead-plan.md
poc/company-claude-prompts/implementation.md
poc/company-claude-prompts/lead-review.md
poc/company-claude-prompts/verification.md
poc/company-claude-prompts/lead-decision.md
poc/company-claude-prompts/git.md
```

`JobWorker.codeAndTest()`는 다음 orchestration 메서드를 호출한다.

```ts
interface ClaudeTeamExecutionPort {
  runDevelopment(
    job: JobRecord,
    options: {
      signal?: AbortSignal;
      onProgress?: (event: DevelopmentProgressEvent) => void | Promise<void>;
    },
  ): Promise<DevelopmentExecutionResult>;

  runGit(
    job: JobRecord,
    mode: PublishMode,
    options: {
      signal?: AbortSignal;
      onProgress?: (event: DevelopmentProgressEvent) => void | Promise<void>;
    },
  ): Promise<PublishExecutionResult>;
}
```

synthetic POC의 `LocalJobExecutor`는 회귀 테스트용으로 유지하고, company profile에서 새
`CompanyClaudeTeamExecutor`를 선택한다.

## 9. API와 UI 계약

새 endpoint를 만들 필요는 없다. 기존 Job polling 응답에 optional 필드를 추가한다.

```ts
interface JobDto {
  // existing fields...
  developmentStages?: DevelopmentStage[];
  developmentHandoffs?: DevelopmentHandoff[];
  developmentArtifacts?: DevelopmentArtifactSummary[];
  developmentRound?: number;
}
```

Job list 응답에는 현재 실행 중인 stage와 마지막 handoff 요약만 넣는다. 전체 산출물은
`GET /api/v1/jobs/:jobId`에서 반환해 목록 polling을 가볍게 유지한다.

UI 매핑:

| stage/role | 좌석 |
|---|---|
| `lead_plan`, `lead_code_review`, `lead_decision` | 클로드 팀장 · Opus |
| `implementation` | 구현 담당 · Sonnet |
| `verification` | 검증 담당 · Sonnet |
| `git` | Git 담당 · Haiku |

`developmentHandoffs`의 최신 항목은 개발팀의 `TEAM HANDOFF` 영역에 표시한다. blocker는 붉은
상태, directive/result는 진행 또는 완료 상태로 표시한다.

현재 UI는 백엔드 필드가 없을 때 기존 JobState로 handoff를 추정한다. 새 필드가 제공되면
실제 role/model/status/message를 우선 사용하도록 확장한다.

## 10. 수정 대상

최소 예상 범위:

1. `lib/office-jobs/domain/job-types.ts`
2. `lib/office-jobs/infrastructure/sqlite-job-repository.ts`
3. `lib/office-jobs/application/job-execution.port.ts`
4. `lib/office-jobs/application/job-worker.ts`
5. `lib/office-jobs/infrastructure/local-job-system.ts`
6. `lib/office-jobs/infrastructure/job-config.ts`
7. 신규 company Claude team executor와 prompt 파일
8. Job HTTP schema/DTO와 frontend contract
9. 실행기·복구·API·UI 테스트

Claude가 회사 포팅 중 이미 같은 책임의 파일을 추가했다면 중복 구현하지 말고 기존
`JobExecutionPort`와 company executor 구조에 이 계약을 합친다.

## 11. 검증 시나리오

### 정상 흐름

1. 구현 승인 후 Opus 계획 stage가 `running`이 된다.
2. Opus 결과에 따라 구현 Sonnet이 실행된다.
3. 변경 파일이 준비되면 Opus 코드 리뷰가 실행된다.
4. 검증 Sonnet이 테스트와 Diff 검증을 수행한다.
5. Opus가 `ready_for_human_git_review`를 반환한다.
6. Job이 `changes_ready`가 되고 Human Gate 2에서 멈춘다.
7. 승인 뒤 Haiku가 Git 내용을 만들고 Commit·Push·PR을 수행한다.
8. `review_pending`에서 Human Gate 3 최종 검토를 기다린다.

### 막힘과 재작업

1. 구현 Sonnet이 blocker를 반환한다.
2. handoff가 `Sonnet 구현 -> Opus 팀장`으로 저장된다.
3. Opus가 수정 방향을 반환한다.
4. 같은 worktree에서 구현 Sonnet을 다시 호출한다.
5. 재작업 round와 모든 지시·보고가 Job detail에 남는다.

### 실패와 복구

- 역할별 timeout이 현재 stage만 실패시킨다.
- 서버 재시작 뒤 완료된 stage는 다시 실행하지 않는다.
- 같은 idempotency action이 동일 역할을 중복 실행하지 않는다.
- 최대 재작업 횟수 뒤에는 자동 반복을 멈춘다.
- 취소 요청은 현재 Claude process를 종료하고 Job을 `canceled`로 만든다.

### 회귀

- 기존 synthetic POC 테스트가 통과한다.
- 분석 lane과 개발 lane은 서로 독립적으로 계속 실행된다.
- Human Gate 1·2·3을 우회할 수 없다.
- final PR URL과 commit SHA는 서버 검증값만 노출한다.
- 역할별 모델과 산출물이 UI 좌석 상세에 표시된다.

## 12. 클로드에게 전달할 지시문

```text
docs/CLAUDE_DEVELOPMENT_TEAM_GUIDE.md를 기준으로 company 개발팀 backend를 구현해.

구성은 Opus 팀장, Sonnet 구현 담당, Sonnet 검증 담당, Haiku Git 담당이다. Opus가
계획·코드 리뷰·막힘 해결·최종 판단을 하고, 서버가 Opus의 nextAction에 따라 역할별
Claude 프로세스를 호출하도록 해. 단일 Claude 호출 안에서 결과만 한꺼번에 만들지 마.

기존 JobState와 polling API는 유지하고 developmentStages, developmentHandoffs,
developmentArtifacts를 SQLite와 Job detail에 추가해. 막힘은 팀장에게 보고하고 팀장
지시로 재작업하되 기본 2회 후 사람에게 escalation해.

company는 이미 격리된 사내 Claude 환경이므로 synthetic용 blanket tool 차단을 복사하지
말고 각 역할에 필요한 회사 도구를 사용하게 해. Human Gate 1 전 코딩, Human Gate 2 전
Git, Human Gate 3 전 merge는 계속 금지해.

정상 흐름, blocker 재지시, 검증 실패 재작업, 서버 재시작 복구, 중복 실행 방지 테스트와
실제 역할별 모델 실행 증거까지 보고해.
```
