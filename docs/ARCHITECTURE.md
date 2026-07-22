# AI Office 아키텍처

> 상태: Draft v0.1  
> 작성일: 2026-07-21  
> 대상: SSD/UFS 시뮬레이터 등 사내 기밀 저장소를 조사해 기능 분석, 견적, 테스트 설계, Git 이슈 초안 및 등록을 수행하는 AI Office

## 1. 목적과 범위

AI Office는 사내 Wiki, 코드, 디버깅 히스토리를 사내 신뢰 영역 안에서 조사하고 다음 산출물을 만든다.

- 근거가 추적 가능한 조사 보고서
- 가정, 작업 분해, 위험, 신뢰도를 포함한 기능 견적
- 단위·통합·회귀·성능 테스트 계획
- 벤더 중립적인 Git 이슈 초안과 승인된 이슈 등록 결과

가장 중요한 불변 조건은 **원문 코드, 로그, Wiki 본문, 검색 발췌 및 이를 복원할 수 있는 임베딩이 사내 신뢰 영역을 벗어나지 않는 것**이다. 외부에 배포한 control plane은 오케스트레이션 메타데이터만 다룰 수 있으며, 코드 문맥이 필요한 추론은 connector/runner와 사내 LLM이 수행한다.

이 문서는 논리·배포 아키텍처, 핵심 데이터 모델, 상태 머신, API·이벤트·플러그인 계약 및 단계별 구현 범위를 정의한다. 세부 위협 모델과 통제는 [SECURITY.md](./SECURITY.md)를 따른다.

## 2. 아키텍처 결정

| 결정 | 선택 | 이유 |
|---|---|---|
| 기본 배포 | 완전 온프레미스 | 기능 요청 자체와 파생 분석도 기밀일 수 있으며 가장 단순하게 비반출을 증명한다. |
| 예외 배포 | 외부 control plane + 사내 outbound-only connector | 외부에는 opaque ID, 상태, 계수, 승인된 파생물만 두고 내부망 인바운드 포트를 열지 않는다. |
| 실행 위치 | 소스와 같은 신뢰 영역의 runner | 검색 결과와 도구 출력이 외부 프롬프트에 포함되는 실수를 구조적으로 막는다. |
| 서비스 구조 | MVP는 경계가 명확한 모듈형 모놀리스 + 비동기 worker | 초기 운영 복잡도를 낮추되 API, 도메인, 저장소, 어댑터 계층을 분리해 이후 서비스 추출이 가능하다. |
| 연동 방식 | capability 기반 plugin adapter | Git/Wiki/디버깅/LLM 벤더를 도메인 모델에서 분리한다. |
| 처리 방식 | lease 기반 at-least-once + 멱등성 | 망 단절과 runner 재시작 후 안전하게 재처리한다. exactly-once를 주장하지 않는다. |
| Git 쓰기 | draft → 내용 봉인 → 2인 승인 → 제한 토큰 publish | LLM이 임의로 사내 Git을 변경할 수 없게 한다. |

외부 LLM에 원문 또는 내부 파생물을 보내는 토폴로지는 지원하지 않는다. 정책상 허용된 조직은 별도 `SANITIZED_ONLY` 모델 route를 활성화할 수 있지만, DLP 승인된 입력만 허용하며 기본값은 비활성이다.

## 3. 신뢰 경계와 논리 구조

```text
┌──────────────────────── 사내 신뢰 영역 ─────────────────────────┐
│                                                                │
│  Wiki   Code/Git   Debug History                               │
│    │       │             │                                     │
│    └──── Source adapters / read-only credentials ───┐          │
│                                                     ▼          │
│  Internal Intake ──► Connector Gateway / PEP ──► Agent Runner  │
│                          │                     │      │          │
│                          │                     │      ├─ Sandbox │
│                          │                     │      └─ Tools   │
│                          │                     ▼                 │
│                          │               Internal LLM Gateway   │
│                          │                     │                 │
│                          ▼                     ▼                 │
│                    Internal Artifact Store + Evidence Index     │
│                          │                                      │
│                 DLP / approval / export gate                    │
│                          │                                      │
│                    Issue publisher adapter                      │
└──────────────────────────┼──────────────────────────────────────┘
                           │ outbound mTLS only (split mode)
                           │ metadata/event + approved export only
┌──────────────────────────▼──────────────────────────────────────┐
│ Control Plane: API/BFF, workflow, metadata DB, audit, relay     │
│ Dashboard: jobs, agents, artifacts, approvals, publication      │
└──────────────── 외부 또는 사내 배포 가능 ──────────────────────┘
```

### 3.1 컴포넌트 책임

| 컴포넌트 | 실행 위치 | 책임 | 금지 사항 |
|---|---|---|---|
| Dashboard | control plane | Job 생성·조회, 진행률, 승인, 감사 UI | split mode에서 원문·내부 파생물 렌더링 금지 |
| Control API/BFF | control plane | 인증, API 버전, UI read model, 명령 수신 | source credential 보관 금지 |
| Workflow Orchestrator | control plane 또는 온프레미스 | Job/Step 상태 전이, 재시도, 승인 대기, 타임아웃 | 직접 source 도구 실행 금지 |
| Outbound Relay | 경계 양쪽 | connector long-poll/WebSocket, 명령·이벤트 전달, 재연결 | source payload 검사·저장 금지 |
| Connector Gateway | 사내 | runner 등록, lease, PEP, adapter registry, local outbox | 외부에서 시작한 인바운드 연결 허용 금지 |
| Agent Runner | 사내 | workflow step 실행, 도구 호출, 산출물 생성 | capability grant 밖의 도구 호출 금지 |
| Internal LLM Gateway | 사내 | 모델 route, quota, prompt/tool schema 검증, 사용량 | 정책 route를 우회한 provider 호출 금지 |
| Source adapters | 사내 | Wiki/code/debug 검색과 증거 조회 | control plane으로 원문 반환 금지 |
| Artifact/Evidence Store | 사내 | 원문 파생물, evidence locator, digest, provenance | 외부 presigned URL 발급 금지 |
| Export Gate/PEP | 사내 | 분류, DLP, 승인 digest 확인, 최소화 | 검사 실패 시 fail-open 금지 |
| Issue Publisher | 사내 | 승인된 digest의 이슈를 최소권한 token으로 1회 등록 | 초안 생성 agent에 write token 제공 금지 |

각 서버 모듈은 `Controller → Application Service → Repository Port → Adapter/Database` 흐름을 지킨다. controller는 인증된 명령을 service에 전달하고 결과를 매핑할 뿐이며, 상태 전이·승인·분류 규칙은 service/domain에 둔다.

### 3.2 POC의 교체 가능한 실행 계약

웹 사무실은 특정 CLI, 모델 또는 저장소 형식을 알지 않는다. 분석과 코딩 실행 port에만 의존한다.

```text
Office UI
   │ job command / progress / approval / artifact review
   ▼
Job Service + persistent FIFO
   ├─ AgentRuntime       ─ OpenCodeCli | CodexCli | Deterministic
   ├─ SimulatorSource   ─ Synthetic | Internal Connector
   └─ JobExecutionPort  ─ ClaudeCode + Worktree/Test/Git | Internal Coding Adapter
```

- `AgentRuntime`은 정규화된 요청과 source snapshot을 받아 버전이 고정된 결과 schema를 반환한다.
- `SimulatorSource`는 허용된 자료만 최소 snapshot과 digest로 만들며, 모델이 임의로 파일 시스템을 탐색하지 않게 한다.
- `JobExecutionPort`는 승인된 coding packet을 업무별 worktree에서 구현하고, 서버 소유 테스트와 Git publisher를 연결한다.
- UI 애니메이션은 모델 고유 event나 token stream이 아니라 `accepted`, 역할별 handoff, `completed` 같은 coarse event만 사용한다.
- 외부 OpenCode Zen 또는 Codex runtime은 합성 source와만 결합할 수 있다. 실제 사내 source는 사내 OpenCode/LLM runtime과 동일한 신뢰 영역에서만 결합한다.
- 분석 agent와 Claude coding runtime에는 Git credential이 없다. deterministic publisher만 최신 change digest 승인 뒤 업무 branch를 Commit하고, 별도 opt-in일 때만 Push한다.

이 경계 덕분에 POC의 `OpenCodeCliRuntime(Zen) + SyntheticSimulatorSource + ClaudeCodeRuntime`을 UI 변경 없이 `OpenCodeCliRuntime(사내 모델) + InternalRepoSource + 사내 CodingRuntime`으로 전환할 수 있다.

### 3.3 현재 로컬 Zen POC 토폴로지

```text
모바일 브라우저
  │ Tailscale, http://<정확한 Mac tailnet IP>:3000
  ▼
로컬 웹 사무실 / same-origin API
  │ server-side proxy, token은 브라우저에 노출하지 않음
  ▼
127.0.0.1:4317 Zen bridge
  ├─ SQLite FIFO + job event history
  ├─ raw 사용자 입력 → 서버 소유 Synthetic 시나리오로 치환
  │    ▼
  │  OpenCode 1.4.3 ── HTTPS ── OpenCode Zen 무료 모델
  └─ 사람 승인 → Claude 업무 worktree → 고정 테스트 → 사람 승인 → Git
```

- 웹서버는 `AI_OFFICE_LOCAL_PROXY_ENABLED=1`일 때 bridge를 사용한다. production에서는 `AI_OFFICE_DEPLOYMENT_MODE=internal`과 `AI_OFFICE_INTERNAL_EXECUTION_ACK=on-prem-only`를 함께 요구한다.
- bridge가 없거나 Zen 호출이 실패하면 명시적인 `5xx` 오류로 닫히며 호스팅 데모, 다른 모델 또는 provider로 fallback하지 않는다.
- POC의 여섯 좌석은 업무 책임과 handoff를 표현하는 논리 에이전트다. 실제 실행은 요청당 OpenCode 프로세스 1개와 모델 턴 1개이며, 구조화 결과에 다섯 전문 역할과 오케스트레이터 결론을 함께 담는다.
- 분석이 끝나면 `awaiting_coding_approval`, 구현·테스트가 끝나면 `changes_ready`에서 멈춘다. 두 승인 모두 optimistic version과 artifact digest를 검증한다.
- Claude는 main checkout이 아니라 repository 밖 전용 worktree의 합성 `src/tests/config`만 수정한다. Push는 기본 비활성이다.
- 사내 전환 때 기본 8GB 서버에서는 `research → framework → estimate → test → git → orchestrator` 순차 실행을 사용한다. 각 역할은 검증된 앞 단계 결과만 이어받고 progress event와 결과 schema를 유지한다. 자원이 충분한 서버에서만 의존성이 없는 단계를 제한적으로 병렬화한다.
- 보안 예외와 만료 조건은 [SECURITY.md의 외부 OpenCode Zen 합성 POC 경계](./SECURITY.md#45-외부-opencode-zen-합성-poc-경계)를 따른다.

## 4. 배포 모드

### 4.1 Mode A — 완전 온프레미스(기본)

Dashboard, control plane, runner, DB, object store, queue, LLM gateway를 모두 사내망에 배포한다. 인터넷 egress를 차단해도 모든 핵심 흐름이 동작해야 한다. 모델 파일, 컨테이너, plugin은 검증된 오프라인 mirror를 통해 반입한다.

### 4.2 Mode B — 외부 control plane + outbound-only 중계(예외)

- 사내 connector가 mTLS로 외부 relay에 연결하며 내부망 인바운드 포트는 없다.
- 민감한 요청 본문은 `INTERNAL_REF`로 사내 intake에 저장한다. control plane은 ref의 opaque ID와 digest만 가진다.
- 외부 dashboard에는 `EXPORTABLE_METADATA` 또는 승인된 `APPROVED_EXPORT`만 표시한다.
- 연결이 끊기면 내부 outbox에 이벤트를 저장하고, lease 만료 후 중복 실행을 멱등키로 흡수한다.
- 외부 control plane 장애가 source 접근이나 credential 유출로 이어지지 않는다. 전역 kill switch를 켜면 connector가 새 lease와 Git 쓰기를 모두 거부한다.

### 4.3 동일 바이너리 원칙

두 모드는 같은 도메인 계약과 상태 머신을 사용한다. 배포 시 다음 route만 바뀐다.

```yaml
deploymentMode: ON_PREM # ON_PREM | SPLIT_OUTBOUND
contentPlane: INTERNAL_ONLY
modelRoutes:
  sourceDerived: INTERNAL_LLM
  sanitized: DISABLED
relay:
  enabled: false
```

## 5. 데이터 분류와 위치

| 분류 | 예 | 저장 위치 | 외부 control plane |
|---|---|---|---|
| `RESTRICTED_SOURCE` | 코드, Wiki 본문, 로그, diff, 검색 발췌, 임베딩 | 사내만 | 금지 |
| `INTERNAL_DERIVED` | 상세 분석, 근거 포함 견적·테스트 계획, 이슈 초안 | 사내만 | 기본 금지 |
| `EXPORTABLE_METADATA` | opaque ID, 상태, 진행률, 계수, digest, 비민감 safe summary | 양쪽 가능 | 허용 |
| `APPROVED_EXPORT` | DLP와 사람 승인을 통과해 봉인된 파생물 | 정책 지정 | 허용 |

`contentRef`는 위치를 나타내는 URI가 아니라 해석 권한이 필요한 opaque handle이다. split mode의 control plane은 내부 handle을 역참조할 수 없다.

## 6. 핵심 도메인 모델

### 6.1 관계

```text
Workspace 1─N Project 1─N Job 1─N StepRun
                             ├─N AgentRun
                             ├─N Artifact ─N EvidenceRef
                             ├─N Approval
                             └─N Publication
Connector 1─N Runner 1─N Lease ─1 StepRun
```

### 6.2 엔티티

| 엔티티 | 핵심 필드 | 불변 조건 |
|---|---|---|
| `Job` | `id, workspaceId, projectId, titleSafe, inputDescriptor, state, requestedOutputs, policyProfile, version` | 민감 본문 대신 internal ref 사용; 전이는 optimistic version 검사 |
| `StepRun` | `id, jobId, stepType, state, dependencies, attempt, maxAttempts, leaseId` | 선행 step 성공 전 실행 금지 |
| `AgentProfile` | `id, role, version, capabilities, modelPolicy, promptDigest` | version 고정; capability 기본 거부 |
| `AgentRun` | `id, jobId, stepRunId, profileRef, runnerId, state, attempt, modelRoute, startedAt` | 실행 당시 profile/policy digest 보존 |
| `Artifact` | `id, jobId, kind, version, state, classification, contentRef, sha256, provenance, createdByRunId` | SEALED 이후 내용 불변; 수정은 새 version |
| `EvidenceRef` | `id, sourceConnectionId, revision, locatorRef, locatorDigest, capturedAt` | 외부 이벤트에는 locatorRef 미포함 |
| `Approval` | `id, jobId, artifactId, action, state, artifactDigest, policyDigest, requiredCount, decisions` | 승인 대상 digest 변경 시 무효; 승인자 중복 불가 |
| `Publication` | `id, jobId, artifactId, adapterId, idempotencyKey, state, externalKey, receiptDigest` | 같은 adapter+repo+idempotencyKey는 최대 1회 생성 |
| `AuditEvent` | `id, correlationId, actor, action, subject, outcome, eventDigest, occurredAt` | append-only, 상관 ID 필수 |

### 6.3 Job 입력 예시

```json
{
  "projectId": "prj_simulator",
  "titleSafe": "REQ-opaque-1042",
  "inputDescriptor": {
    "mode": "INTERNAL_REF",
    "ref": "intake:req_01J4M5X8",
    "sha256": "sha256:6bb1...e921",
    "classification": "RESTRICTED_SOURCE"
  },
  "requestedOutputs": [
    "INVESTIGATION_REPORT",
    "ESTIMATE",
    "TEST_PLAN",
    "ISSUE_DRAFT"
  ],
  "policyProfile": "ssd-ufs-default@1",
  "sourceScopes": ["scope:wiki:sim", "scope:git:sim", "scope:debug:sim"]
}
```

## 7. 상태 머신

### 7.1 Job

```text
DRAFT → READY → QUEUED → RUNNING ─┬→ AWAITING_APPROVAL → PUBLISHING → COMPLETED
                                  ├→ COMPLETED        (등록 요청 없음)
                                  ├→ BLOCKED → QUEUED (입력/정책 해소)
                                  └→ FAILED → QUEUED  (명시적 retry)
모든 비종료 상태 → CANCELING → CANCELED
```

| 현재 상태 | 명령/조건 | 다음 상태 | 실행 주체 |
|---|---|---|---|
| DRAFT | 입력 schema와 source scope 검증 | READY | Control service |
| READY | policy snapshot 고정 | QUEUED | Orchestrator |
| QUEUED | 첫 step lease | RUNNING | Orchestrator |
| RUNNING | issue draft가 SEALED되고 publish 요청 | AWAITING_APPROVAL | Orchestrator |
| AWAITING_APPROVAL | digest에 대해 서로 다른 2인 승인 | PUBLISHING | Approval service |
| PUBLISHING | publisher receipt 저장 | COMPLETED | Internal publisher |
| RUNNING | 모든 요청 산출물 SEALED | COMPLETED | Orchestrator |
| 임의 비종료 | 재시도 불가 오류 | FAILED | Orchestrator |

### 7.2 StepRun/AgentRun

```text
PENDING → QUEUED → LEASED → RUNNING → SUCCEEDED
                       │         ├──→ RETRY_WAIT → QUEUED
                       │         ├──→ FAILED
                       │         └──→ TIMED_OUT
                       └────────────→ QUEUED (lease expiry, attempt 증가)
PENDING|QUEUED|LEASED|RUNNING|RETRY_WAIT → CANCELED
```

runner는 `leaseId`, `fencingToken`, `expiresAt`를 받아야 하며 이벤트 제출 시 모두 검증한다. 늦게 도착한 이전 fencing token의 결과는 감사 로그만 남기고 상태에 반영하지 않는다.

### 7.3 Artifact와 Approval

```text
Artifact: DRAFT → VALIDATING → SEALED → (EXPORT_REVIEW → EXPORTED)
                       └→ REJECTED
Approval: PENDING → APPROVED | REJECTED | EXPIRED | CANCELED
Publication: PENDING → EXECUTING → SUCCEEDED | FAILED | UNKNOWN
```

`UNKNOWN`은 Git API timeout처럼 생성 여부를 모를 때 사용한다. 재호출 전에 provider lookup 또는 idempotency marker 검색으로 reconcile한다.

## 8. 표준 워크플로

1. 내부 intake가 기능 요청 원문을 저장하고 `INTERNAL_REF`를 만든다.
2. orchestrator가 `RESEARCH` step을 큐에 넣는다.
3. 사내 runner의 research agent가 Wiki/code/debug adapter를 읽고 evidence ref가 포함된 조사 artifact를 만든다.
4. estimation agent와 test-design agent가 내부 artifact를 입력으로 병렬 실행한다.
5. issue-draft agent가 요약, 범위, 가정, acceptance criteria, test matrix가 포함된 벤더 중립 초안을 만든다.
6. validator가 schema, citation 존재 여부, DLP, secret 검사를 수행하고 artifact digest를 봉인한다.
7. Git 등록 요청 시 봉인 digest에 대해 2인 승인을 받는다.
8. deterministic publisher가 승인 bundle과 capability grant를 재검증하고 issue adapter를 호출한다.
9. `PublicationReceipt`를 저장하고 Job을 완료한다.

LLM은 1~5단계의 제안만 생성한다. 승인 판단, 상태 전이, DLP, capability 검증, publish는 결정론적 서비스가 담당한다.

## 9. Control API v1

모든 쓰기 요청은 `Authorization`, `X-Correlation-Id`, `Idempotency-Key`를 요구한다. 오류는 `{ "error": { "code", "message", "retryable", "correlationId", "details" } }` 형식이다.

| Method | Path | 용도 |
|---|---|---|
| POST | `/api/v1/jobs` | Job 생성 |
| GET | `/api/v1/jobs/{jobId}` | Job read model 조회 |
| POST | `/api/v1/jobs/{jobId}:cancel` | 취소 요청 |
| POST | `/api/v1/jobs/{jobId}:retry` | 실패 step 명시적 재시도 |
| GET | `/api/v1/jobs/{jobId}/events` | SSE 이벤트 구독, `Last-Event-ID` 지원 |
| GET | `/api/v1/jobs/{jobId}/artifacts` | 권한별 artifact manifest 조회 |
| GET | `/api/v1/artifacts/{artifactId}/content` | 사내 또는 `APPROVED_EXPORT` 내용만 조회 |
| POST | `/api/v1/artifacts/{artifactId}/approvals` | 승인 요청 생성 |
| POST | `/api/v1/approvals/{approvalId}/decisions` | 승인/반려 결정 |
| POST | `/api/v1/jobs/{jobId}:publish-issue` | 승인 완료된 digest의 등록 명령 |

승인 결정 예시:

```json
{
  "decision": "APPROVE",
  "artifactDigest": "sha256:91ca...20d1",
  "role": "REPOSITORY_MAINTAINER",
  "reason": "범위와 acceptance criteria 검토 완료",
  "expectedApprovalVersion": 3
}
```

`artifactDigest`나 version이 다르면 `409 APPROVAL_TARGET_CHANGED`를 반환한다.

## 10. Connector Relay API v1

split mode에서 connector가 outbound mTLS로만 호출한다. body에는 `RESTRICTED_SOURCE` 또는 `INTERNAL_DERIVED` 내용을 넣을 수 없다.

| Method | Path | 용도 |
|---|---|---|
| POST | `/relay/v1/sessions` | connector identity/capability 등록과 단기 session 발급 |
| POST | `/relay/v1/leases:claim` | 실행 가능한 work 장기 poll |
| POST | `/relay/v1/leases/{leaseId}:heartbeat` | lease 연장과 진행률 보고 |
| POST | `/relay/v1/events:batch` | local outbox 이벤트 일괄 전송 |
| POST | `/relay/v1/artifact-manifests:batch` | 내용 없는 manifest 전송 |
| POST | `/relay/v1/leases/{leaseId}:complete` | 성공/실패와 결과 manifest 확정 |

lease 응답 예시:

```json
{
  "leaseId": "lease_01J4N0",
  "fencingToken": 17,
  "expiresAt": "2026-07-21T08:05:30Z",
  "work": {
    "jobId": "job_01J4MZ",
    "stepRunId": "step_01J4N0",
    "stepType": "RESEARCH",
    "input": {
      "mode": "INTERNAL_REF",
      "ref": "intake:req_01J4M5X8",
      "sha256": "sha256:6bb1...e921"
    },
    "agentProfile": "research.simulator@1",
    "policyDigest": "sha256:032f...c112",
    "capabilityGrantId": "grant_01J4N0"
  }
}
```

## 11. 이벤트 계약과 UI 최소 필드

전달은 at-least-once이며 소비자는 `eventId`로 중복 제거하고 `(subject, entityVersion)`으로 순서를 보호한다. 모든 이벤트는 다음 envelope을 사용한다.

```json
{
  "specVersion": "1.0",
  "schemaVersion": 1,
  "eventId": "evt_01J4N2",
  "type": "job.state.changed",
  "source": "control-plane/workflow",
  "subject": "job/job_01J4MZ",
  "workspaceId": "ws_storage",
  "correlationId": "corr_01J4MY",
  "causationId": "cmd_01J4N1",
  "occurredAt": "2026-07-21T08:02:13Z",
  "entityVersion": 8,
  "classification": "EXPORTABLE_METADATA",
  "data": {}
}
```

### 11.1 `job.state.changed`

UI 필수 data: `jobId, previousState, state, stage, progress.percent, safeSummary, updatedAt`.

```json
{
  "jobId": "job_01J4MZ",
  "previousState": "QUEUED",
  "state": "RUNNING",
  "stage": "RESEARCH",
  "progress": { "completedSteps": 1, "totalSteps": 5, "percent": 20 },
  "safeSummary": "사내 자료 조사 중",
  "updatedAt": "2026-07-21T08:02:13Z"
}
```

### 11.2 `agent.run.state.changed`

UI 필수 data: `agentRunId, jobId, agentType, state, stage, attempt, progressPercent, safeSummary, updatedAt`.

```json
{
  "agentRunId": "arun_01J4N2",
  "jobId": "job_01J4MZ",
  "agentType": "RESEARCH",
  "state": "RUNNING",
  "stage": "CODE_SEARCH",
  "attempt": 1,
  "progressPercent": 45,
  "safeSummary": "근거 수집 중",
  "updatedAt": "2026-07-21T08:03:05Z"
}
```

### 11.3 `artifact.created` / `artifact.state.changed`

UI 필수 data: `artifactId, jobId, kind, version, state, classification, availability, sha256, safeTitle, createdByRunId, updatedAt`.

```json
{
  "artifactId": "art_01J4N7",
  "jobId": "job_01J4MZ",
  "kind": "TEST_PLAN",
  "version": 1,
  "state": "SEALED",
  "classification": "INTERNAL_DERIVED",
  "availability": "INTERNAL_ONLY",
  "sha256": "sha256:91ca...20d1",
  "safeTitle": "테스트 계획 생성 완료",
  "createdByRunId": "arun_01J4N2",
  "updatedAt": "2026-07-21T08:08:40Z"
}
```

### 11.4 `approval.requested` / `approval.decided`

UI 필수 data: `approvalId, jobId, artifactId, action, state, artifactDigest, requiredApprovals, recordedApprovals, expiresAt, updatedAt`.

```json
{
  "approvalId": "apr_01J4NB",
  "jobId": "job_01J4MZ",
  "artifactId": "art_01J4NA",
  "action": "PUBLISH_ISSUE",
  "state": "PENDING",
  "artifactDigest": "sha256:91ca...20d1",
  "requiredApprovals": 2,
  "recordedApprovals": 1,
  "expiresAt": "2026-07-22T08:10:00Z",
  "updatedAt": "2026-07-21T08:10:00Z"
}
```

추가 핵심 이벤트는 `job.created`, `agent.run.started`, `artifact.exported`, `publication.state.changed`, `policy.denied`, `connector.health.changed`이다. 이벤트 `data`에는 source 경로, query, prompt, 발췌, 내부 사용자 메모를 넣지 않는다.

## 12. Plugin Adapter 구조

모든 plugin은 사내 connector 프로세스 또는 격리 sidecar에서 실행한다. control plane에는 manifest와 health만 노출한다.

```text
connector/
  domain/                 # EvidenceRef, IssueDraft 등 벤더 중립 타입
  application/            # SearchSources, PublishIssue use case
  ports/                  # SourceAdapter, IssueAdapter, ModelAdapter
  adapters/
    git/<provider>/
    wiki/<provider>/
    debug/<provider>/
    llm/<runtime>/
  policy/                 # capability, DLP, prompt/tool 검증
  sandbox/                # plugin process isolation
```

manifest 예시:

```json
{
  "id": "git.company-provider",
  "contractVersion": "1.0",
  "kind": "SOURCE_AND_ISSUE",
  "runtime": "SIDECAR",
  "capabilities": [
    "code.search",
    "code.read",
    "history.read",
    "issue.create"
  ],
  "dataResidency": "INTERNAL_ONLY",
  "configSchemaRef": "schema:git-company-provider@2",
  "healthcheck": { "timeoutMs": 2000 },
  "limits": { "maxResults": 100, "maxBytesPerRead": 1048576 }
}
```

### 12.1 SourceAdapter port

```ts
interface SourceAdapter {
  capabilities(): Promise<Capability[]>;
  search(request: SearchRequest, context: AdapterContext): Promise<SearchPage>;
  read(request: ReadRequest, context: AdapterContext): Promise<SourceDocument>;
  revisions(request: RevisionRequest, context: AdapterContext): Promise<RevisionPage>;
  health(): Promise<AdapterHealth>;
}
```

`SourceDocument.content`는 runner memory와 내부 artifact store에서만 존재하며 relay DTO에는 정의하지 않는다. 각 호출은 `jobId, agentRunId, correlationId, capabilityGrant, deadline, maxBytes`가 든 `AdapterContext`를 요구한다.

### 12.2 IssueAdapter port

```ts
interface IssueAdapter {
  validateDraft(draft: IssueDraft): Promise<ValidationResult>;
  createIssue(command: PublishIssueCommand, context: AdapterContext): Promise<PublicationReceipt>;
  findByIdempotencyKey(key: string, context: AdapterContext): Promise<PublicationReceipt | null>;
}
```

벤더 중립 publish 명령 예시:

```json
{
  "repositoryRef": "repo:simulator-core",
  "draft": {
    "title": "Add programmable latency fault profile",
    "bodyFormat": "MARKDOWN",
    "bodyRef": "artifact:art_01J4NA:v1",
    "labels": ["enhancement", "simulator"],
    "acceptanceCriteria": [
      "Profile is validated before a simulation starts",
      "Existing profiles remain backward compatible"
    ]
  },
  "artifactDigest": "sha256:91ca...20d1",
  "approvalBundleRef": "approval-bundle:apr_01J4NB",
  "idempotencyKey": "publish:job_01J4MZ:art_01J4NA:v1"
}
```

receipt는 `adapterId, repositoryRef, externalKey, externalUrl, createdAt, requestDigest, responseDigest`만 공통 필드로 요구한다. provider 고유 ID는 `providerMetadata`에 격리하며 도메인 로직에서 해석하지 않는다.

### 12.3 ModelAdapter port

`ModelAdapter.generate()`는 structured output schema, 허용 tool 목록, classification, timeout을 필수로 받는다. `sourceDerived` classification은 `INTERNAL_LLM` route에서만 실행된다. tool call은 runner가 재검증하며 모델이 source credential이나 직접 네트워크 권한을 얻지 않는다.

## 13. 저장, 일관성, 감사

- Control DB: Job/Step/AgentRun/manifest/Approval read model과 optimistic version.
- Internal metadata DB: source connection, capability grant, evidence, internal artifact manifest, local approval mirror.
- Internal object store: artifact 본문과 암호화된 prompt/tool transcript. 보존 기간은 분류 정책별 설정.
- Queue: Job step과 재시도. DB transaction과 outbox를 함께 커밋한다.
- Audit ledger: 명령, 정책 결정, tool call, 승인, publish receipt를 append-only로 기록하고 digest chain 또는 WORM 저장소로 보호한다.
- 모든 로그는 `correlationId, jobId, stepRunId, agentRunId`를 사용하되 source 내용과 credential은 구조적으로 제외한다.

## 14. 실패와 복구

- connector offline: control plane은 `WAITING_FOR_CONNECTOR` safe status만 표시하고 새 work를 보존한다.
- lease expiry: 새 fencing token으로 재큐잉하며 이전 결과는 무시한다.
- LLM timeout/rate limit: bounded exponential backoff 후 다른 **허용된 내부 route**로만 failover한다.
- adapter 오류: retryable 분류와 `retryAfter`를 반환하며 maxAttempts 초과 시 Job을 `BLOCKED` 또는 `FAILED`로 전환한다.
- Git create timeout: Publication을 `UNKNOWN`으로 두고 idempotency lookup으로 reconcile하기 전 재생성하지 않는다.
- DLP/PEP 장애: artifact export와 Git 쓰기는 fail-closed다.
- kill switch: 새 lease, source read, model call, export, publish를 범위별로 중단할 수 있다.

## 15. 보안 통제 연결

아키텍처는 [SECURITY.md](./SECURITY.md)의 다음 정책을 PEP에서 강제한다.

- 원문 비반출(Non-Export)·파생물 최소화
- 기본 완전 온프레미스, 예외 outbound-only 중계
- 에이전트 capability 기반 최소권한과 prompt 비신뢰 경계
- DLP 기반 산출물 반출 게이트
- Git 쓰기 이중 승인 게이트
- 불변 감사 추적·상관 ID
- fail-closed·전역 kill switch

## 16. 관측성과 목표

| 항목 | MVP 목표 |
|---|---|
| Control API 가용성 | 월 99.5% |
| 상태 이벤트 UI 반영 | 연결 정상 시 p95 2초 이내 |
| lease 중복으로 인한 중복 Git 이슈 | 0건 |
| 원문/발췌 외부 egress | 0 byte, 정책 테스트로 검증 |
| 감사 이벤트 누락 | 민감 action 기준 0건 |
| connector 장애 복구 | 재연결 후 5분 이내 outbox 동기화 |

핵심 metric은 `jobs_by_state`, `step_duration_seconds`, `lease_expired_total`, `policy_denied_total`, `dlp_blocked_total`, `approval_age_seconds`, `publication_unknown_total`, `connector_outbox_depth`다. 원문이 label이나 trace attribute에 들어가지 않도록 cardinality와 redaction을 제한한다.

## 17. 검증 전략

1. **상태 머신 단위/property 테스트:** 허용되지 않은 전이, stale version, stale fencing token 거부.
2. **계약 테스트:** 각 adapter가 공통 conformance suite와 JSON schema를 통과하는지 검증.
3. **정책 음성 테스트:** canary secret, 코드 조각, 경로, prompt injection이 relay/event/export에 포함될 때 차단.
4. **승인 테스트:** digest 변경, 동일 승인자 중복, 만료 승인, 역할 불일치, 1인 승인 publish를 모두 거부.
5. **멱등성 테스트:** relay 재전송, worker crash, Git timeout에서 이슈가 한 번만 생성됨을 검증.
6. **E2E:** Wiki+code+debug 조사 → 견적 → 테스트 계획 → draft → 2인 승인 → fake Git adapter publish.
7. **배포 모드 parity:** ON_PREM과 SPLIT_OUTBOUND에서 같은 workflow contract suite 실행.
8. **망 단절/복구:** 장시간 connector 단절, outbox 누적, 순서 역전, 재연결을 주입.
9. **LLM 품질 회귀:** 고정된 비기밀 golden corpus로 citation coverage, schema validity, 견적 calibration 측정.

## 18. MVP에서 확장까지

| 단계 | 범위 | 완료 기준 | 예상 |
|---|---|---|---|
| Foundation | 도메인 schema, Job/Step 상태 머신, 내부 artifact store, audit/outbox, mock adapter | 상태/이벤트 contract test와 비반출 테스트 통과 | 2주 |
| MVP | 온프레미스 dashboard/control plane, 내부 LLM 1종, Wiki/Git/debug read adapter 각 1종, 조사·견적·테스트·draft, 수동 2인 승인, Git publisher 1종 | 대표 기능 요청 10건을 사람 검토 하에 end-to-end 처리 | 4~6주 |
| Split Pilot | outbound relay, metadata-only 외부 dashboard, offline queue, mTLS rotation, DLP export | 보안 검토와 망 단절/침해 시나리오 통과 | 3~4주 |
| Scale | HA control plane, runner pool, fair scheduling, adapter SDK, model routing, 비용·품질 평가 | 다중 프로젝트 격리 및 목표 처리량/SLO 충족 | 6~8주 |
| Enterprise | 정책-as-code, WORM 감사, air-gap 공급망, 다중 Git/Wiki, SBOM/plugin signing | 운영·감사·DR runbook 및 정기 통제 증적 자동화 | 지속 |

예상은 5~7명(backend 2, AI/ML 1~2, frontend 1, platform/security 1, QA 일부), 기존 IdP·사내 LLM·source API가 준비되어 있다는 가정이다. source API 부재, 폐쇄망 모델 서빙 신규 구축, 보안 인증 범위는 별도 산정한다.

### MVP 비범위

- LLM의 자동 merge, code push, 이슈 자동 종료
- 외부 LLM에 내부 source-derived prompt 전달
- 임의 shell/network 접근
- 모든 사내 source 벤더를 동시에 지원
- 의미 기반 원문 임베딩의 외부 vector DB 저장

## 19. 구현 순서와 의존성

1. JSON Schema/OpenAPI로 Job, event envelope, adapter port를 동결한다.
2. policy profile, 분류, capability grant와 audit/outbox를 먼저 구현한다.
3. mock adapter로 상태 머신과 UI를 연결한다.
4. read-only Wiki/Git/debug adapter와 내부 LLM gateway를 연결한다.
5. artifact validation/DLP/approval을 구현한 뒤 마지막에 Git write adapter를 활성화한다.
6. 온프레미스 E2E를 통과한 후에만 split outbound topology를 연다.

이 순서는 Git write와 외부 relay가 비반출·승인 통제보다 먼저 배포되는 것을 방지한다.
