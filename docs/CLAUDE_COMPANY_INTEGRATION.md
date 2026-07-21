# Claude용 사내 연동 인계서

이 문서는 Claude가 `ai-office`와 회사 성능 시뮬레이터 저장소를 함께 열고,
사내 OpenCode 및 사내 LLM에 연결할 때 사용하는 작업 지시서다.

## 1. 현재 상태

- 웹 UI와 결과 계약은 동작한다.
- 외부 Zen POC는 합성 저장소만 사용한다.
- 현재 POC 실행은 요청당 OpenCode 프로세스 1개, 모델 호출 1회다.
- 화면의 여섯 좌석은 논리 역할이다.
- 사내 연동에서는 UI를 다시 만들지 말고 `AgentRuntime`과 `SimulatorSource`를 교체한다.

| 내부 role id | 화면 역할 | 회사 자료 |
|---|---|---|
| `orchestrator` | 오비트 | 요청 분해와 최종 Claude 인계팩 |
| `research` | DLD · 위키 | `.LLM`, DLD, 디버깅 이력 |
| `framework` | 코드 · 모델링 | `common`, FTL, FIL, HIL |
| `estimate` | TopView · 영향/견적 | 커맨드 시나리오와 패킷 흐름 |
| `test` | 테스트 | 기존 테스트와 성능 모델 정합성 |
| `git` | Claude · Git | 코딩 인계팩과 이슈 초안 |

## 2. 소스를 열기 전 필수 조건

다음 조건이 모두 충족되기 전에는 실제 simulator 저장소를 Claude/OpenCode에 열지 않는다.

- 회사가 승인한 사내 Claude/OpenCode/LLM endpoint다.
- 입력과 출력이 모델 학습에 사용되지 않고 보존 기간이 회사 정책과 일치한다.
- 외부 provider로 나가는 network egress가 차단되거나 allowlist로 제한된다.
- 허용 provider/model ID 목록을 서버가 검증한다.
- simulator와 문서 접근 권한은 우선 read-only다.

개인용 또는 외부 Claude를 사용해야 한다면 `ai-office` 골격만 보여 주고 회사 저장소,
경로, 문서, 코드, 성능 수치는 제공하지 않는다.

## 3. Claude에게 두 저장소를 보여 주는 방법

두 저장소를 같은 상위 디렉터리에 둔다. 실제 이름과 경로는 달라도 된다.

```text
company-workspace/
├── ai-office/
└── simulator/
```

승인된 사내 Claude/OpenCode만 `company-workspace`를 작업 공간으로 열고 두 저장소를 읽게 한다.
회사 경로를 코드에 하드코딩하지 말고 [agents.example.yaml](../config/agents.example.yaml)을
복사한 사내 전용 설정 파일에만 기록한다.

```bash
cp ai-office/config/agents.example.yaml ai-office/config/agents.company.yaml
cp ai-office/config/opencode.company.example.json ai-office/config/opencode.company.json
chmod 600 ai-office/config/agents.company.yaml ai-office/config/opencode.company.json
```

두 사내 설정 파일은 `.gitignore`에 포함돼 있다. OpenCode 작업 디렉터리는 두 저장소의
공통 상위인 `company-workspace`로 지정하고 `external_directory` 권한은 계속 거부한다.

## 4. 역할별 모델 선택

[opencode.company.example.json](../config/opencode.company.example.json)은 역할마다 다른
OpenCode 모델을 선택할 수 있는 예시다. 회사 OpenCode가 표시하는 정확한 모델 ID를 사용한다.

```bash
export AI_OFFICE_MODEL_ORCHESTRATOR='<company-provider>/<general-model>'
export AI_OFFICE_MODEL_RESEARCH='<company-provider>/<general-model>'
export AI_OFFICE_MODEL_FRAMEWORK='<company-provider>/CodeLLMPro'
export AI_OFFICE_MODEL_ESTIMATE='<company-provider>/<general-model>'
export AI_OFFICE_MODEL_TEST='<company-provider>/CodeLLMPro'
export AI_OFFICE_MODEL_GIT='<company-provider>/CodeLLMPro'
```

UI 모델 선택 기능은 다음 계약으로 구현한다.

- 서버가 허용 모델 카탈로그와 기본 배정을 반환한다.
- UI는 카탈로그의 `id`만 선택한다.
- 요청은 `agentModels: { runtimeRole: modelCatalogId }` 형태로 전달한다.
- `runtimeRole`은 설정의 `runtime_role`이며 기존
  `orchestrator|research|framework|estimate|test|git` 계약을 그대로 사용한다.
- 서버가 catalog id를 실제 OpenCode model id로 변환한다.
- 변환된 provider/model ID가 회사 allowlist에 포함되는지 서버가 다시 검증한다.
- 사용자가 입력한 임의 model 문자열을 그대로 CLI에 넘기지 않는다.

## 5. Claude가 구현할 최소 작업

1. `InternalSimulatorSource`를 추가해 설정된 `.LLM`, DLD, TopView, `common`, FTL, FIL,
   HIL에서 요청과 관련된 파일만 읽는다.
2. `InternalOpenCodeRuntime` 또는 company profile을 추가하고 외부 Zen이 아닌 사내
   OpenCode endpoint/model만 사용한다.
3. 오케스트레이터가 `research`, `framework`, `estimate`, `test`, `git` 역할을 호출하고
   역할별 선택 모델을 적용한다.
4. 현재 `PocModelOutput` 결과 계약은 유지한다. UI 변경을 최소화하기 위해 role id도 유지한다.
5. capabilities API에 모델 카탈로그와 현재 agent-model 배정을 추가하고, 사무실 각 좌석에
   허용 모델을 선택하는 작은 select를 붙인다.
6. Git 연동은 처음에는 이슈 초안까지만 만든다. 실제 등록은 사람 승인 후 실행한다.

시작할 코드 위치:

- `lib/poc/infrastructure/opencode-runtime-config.ts`
- `lib/poc/infrastructure/opencode-process.ts`
- `lib/poc/infrastructure/runtime-registry.ts`
- `lib/poc/infrastructure/synthetic-simulator-source.ts`
- `lib/poc/domain/poc-schema.ts`
- `lib/poc/domain/poc-types.ts`
- `app/features/office/api/poc-client.ts`
- `app/features/office/office-data.ts`

`poc/simulator/AGENTS.md`와 합성 prompt 파일은 무결성 검사가 걸려 있다. 사내 prompt는
별도 디렉터리에 만들고 company runtime에서만 사용한다.

### 대기열·히스토리·에러 표시

현재 POC의 `/api/v1/poc/runs`는 응답이 끝날 때까지 연결을 잡는 단일 실행 API다.
합성 POC UI는 최대 10개의 실행·대기 업무와 최근 완료·실패 20건의 원문·결과를 브라우저
`localStorage`에 보관한다. 한 탭에서 쓰는 합성 데이터 시연 전용이며 회사 정보에는 사용하지 않는다.
복수 사용자, 중앙 감사, 브리지 재시작을 견뎌야 하는 회사 버전에는 이 저장 방식을 쓰지 않는다.

회사 버전은 다음 최소 계약만 서버에 영속화한다.

- `POST /api/v1/jobs`는 업무를 저장하고 즉시 `202 { jobId, state, queuePosition }`을 반환한다.
- 회사 SSO identity와 허용된 project scope를 job에 고정하고, 목록·상세·event마다
  tenant, project, job 소유권을 다시 확인한다.
- 기본 worker는 생성 순서대로 한 건씩 처리한다. 상태는
  `QUEUED | RUNNING | COMPLETED | FAILED | CANCELED`만 사용한다.
- `Idempotency-Key`를 사용자·project 범위에서 검증하고 같은 요청의 중복 실행을 막는다.
- 사용자·project별 queue 상한, 요청 속도, token·비용 budget, 실행 timeout과 retry 상한을
  적용한다. 초과 시 새 job을 저장하지 않고 `429`와 안전한 재시도 시점을 반환한다.
- `GET /api/v1/jobs`는 권한 범위 안의 대기열과 완료 히스토리를 pagination으로,
  `GET /api/v1/jobs/{jobId}`는 권한 확인 후 결과를 반환한다.
- `GET /api/v1/jobs/{jobId}/events`는 `job.state.changed`와
  `agent.run.state.changed`를 전달한다. UI는 이를 업무 카드와 각 좌석 상태에 표시한다.
- 에이전트 실패에는 `agentRole, code, safeMessage, retryable, attempt, occurredAt,
  correlationId`만 노출한다. 원문 prompt, 결과 본문, stack trace, 사내 경로는 이벤트·로그에 넣지 않는다.
- 원문 prompt와 결과는 승인된 사내 암호화 저장소에만 보관하고 권한·보존 기간을 적용한다.
  브라우저 `localStorage`, URL, 브라우저 히스토리에는 저장하지 않는다.
- 완료·실패 job에는 TTL을 적용하고, 대기 취소·히스토리 삭제도 같은 감사·권한 검사를 거친다.

상세 상태 모델이 필요해질 때만 [ARCHITECTURE.md](./ARCHITECTURE.md)의 Control API와 이벤트
계약으로 확장한다. 첫 회사 POC에는 별도 메시지 브로커나 복잡한 우선순위 기능을 넣지 않는다.

## 6. Claude에게 그대로 줄 프롬프트

```text
ai-office 저장소와 회사 simulator 저장소를 함께 분석해 줘.

먼저 ai-office/docs/CLAUDE_COMPANY_INTEGRATION.md와
ai-office/config/agents.example.yaml을 읽어.

목표:
1. SyntheticSimulatorSource를 회사 저장소용 InternalSimulatorSource로 교체
2. 외부 Zen 대신 회사 OpenCode와 사내 LLM만 사용
3. .LLM, DLD, TopView, common, FTL, FIL, HIL 경로는 설정 파일로 주입
4. 역할별 허용 LLM 모델 선택 기능 추가
5. 현재 UI와 PocModelOutput role id는 유지
6. 결과에 Claude 코딩 인계팩과 Git 이슈 초안 포함
7. 업무는 서버의 영속 FIFO 대기열에서 한 건씩 처리하고, 히스토리와 에이전트 오류를 UI에 표시

먼저 두 저장소의 실제 구조와 회사 OpenCode 모델 ID를 확인하고,
작은 단계로 구현해. 합성 POC 경로와 회사 경로가 섞이지 않게 해.
회사 코드나 문서를 외부 모델로 전송하지 마.
```

## 7. 완료 기준

- UI에서 역할별 허용 모델을 선택할 수 있다.
- 실행 결과에 각 역할이 실제 사용한 모델 ID가 표시된다.
- 코드 분석 역할에는 `CodeLLMPro`를 배정할 수 있다.
- 요청과 관련된 DLD, TopView, 코드 근거가 파일 locator와 함께 결과에 남는다.
- 같은 요청을 반복하면 동일한 역할·결과 schema가 생성된다.
- 여러 업무를 연속 등록하면 FIFO 대기열에 남고 새로고침·서버 재시작 후에도 이어진다.
- 실패한 에이전트와 안전한 오류 설명을 해당 좌석 및 업무 히스토리에서 확인할 수 있다.
- 외부 Zen을 끈 상태에서도 회사 OpenCode만으로 끝까지 완료된다.
- Git 이슈는 승인 전에는 실제 등록되지 않는다.

## 8. 회사에서 먼저 확인할 값

- 회사 OpenCode 버전과 실행 명령
- `CodeLLMPro`를 포함한 정확한 provider/model ID 목록
- simulator 저장소의 실제 `.LLM`, DLD, TopView, common, FTL, FIL, HIL 위치
- GitHub Enterprise 주소, 이슈 저장소, 인증 방식
- 회사 데이터가 외부로 나가지 않는다는 네트워크 정책
