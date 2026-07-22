# Claude용 사내 연동 인계서

이 문서는 사내 Claude에게 `ai-office`와 회사 성능 시뮬레이터 저장소를 함께 보여 주고,
현재 합성 adapter만 회사 adapter로 교체하도록 지시하는 인계서다.

## 1. 이미 구현된 골격

UI와 업무 상태 머신은 다시 만들 필요가 없다.

- `POST/GET /api/v1/jobs` 기반 SQLite 영속 FIFO와 히스토리
- OpenCode 분석실 → 사람 승인 → Claude 개발실 → 서버 테스트 → 사람 승인 → Git
- 분석 패킷 digest와 변경 digest에 묶인 optimistic version 승인
- 업무별 `ai-office/<job-id>` Git branch와 repository 밖 전용 worktree
- Claude의 shell/network/Git 도구 차단과 변경 경로 allowlist
- Commit과 Push 분리, Push 기본 비활성
- 실행기·저장소를 교체하기 위한 `AgentRuntime`, `SimulatorSource`, `JobExecutionPort`

Zen 합성 POC는 요청당 OpenCode 프로세스 1개·모델 턴 1개로 여러 논리 역할의 결과를 함께
만든다. `company` profile은 이미 같은 결과 schema로 여섯 독립 턴을 순차 실행한다.

사내 모델에서 각 역할을 더 깊게 순차 실행하고 진행 상황을 좌석에 표시하는 정확한 연결
계약은 [Company 5+1 순차 분석 연동](./COMPANY_SEQUENTIAL_ANALYSIS.md)을 따른다. 별도
인메모리 status API를 만들지 않고 현재 SQLite Job polling에 붙인다.
순서·검증·progress는 `sequential-agent-runtime.ts`, codemate 인증과 격리 실행은
`company-turn-executor.ts`, 역할 지시는 `poc/company-prompts`에 구현돼 있다. 사내 포팅의
첫 작업은 이 실행기를 다시 만드는 것이 아니라 실제 저장소용 source extension을 제공하는 것이다.

## 2. 역할 계약

화면의 role id는 API 호환성을 위해 유지한다. 이름과 실제 사내 경로는 설정으로 바꾼다.

| role id | 화면 역할 | 찾아야 할 회사 자료 | Claude 인계 기여 |
|---|---|---|---|
| `orchestrator` | 오비트 | 모든 역할 결과 | 구현 순서, 결정 사항, 최종 coding packet |
| `research` | DLD · 위키 | `.LLM`, DLD, 설계 문서, 디버깅 이력 | 요구사항·상세 스펙·근거 locator |
| `framework` | 코드 · 모델링 | `common`, SystemC convention, FTL/FIL/HIL | 기존 구조, 수정 지점, 모델 시간/상태 영향 |
| `estimate` | TopView · 영향/견적 | command scenario, packet-flow 그림 | 계층별 영향, 의존성, 작업 크기·위험 |
| `test` | 테스트 | unit/integration/regression/performance harness | 수용 기준, 테스트 matrix, golden trace |
| `git` | 인계 · Git | issue/PR template, CODEOWNERS, 기존 이슈 | Claude-ready brief와 Git 초안 |

실제 디렉터리는 `common/FTL/FIL/HIL`이라고 가정하지 않는다. repository를 먼저 탐색하고,
회사 전용 설정에 발견한 경로를 넣는다.

## 3. 두 저장소 배치

예시는 다음과 같다. 실제 경로는 달라도 된다.

```text
/srv/company-workspace/
├── ai-office/
└── simulator/
```

사내 Claude에게 두 저장소를 열어 주되, 첫 단계에서는 `ai-office`만 수정하도록 한다.
simulator는 adapter 검증 중 read-only로 시작하고, 최종 coding runtime에서만 승인된 worktree
쓰기 권한을 연다.

`config/agents.example.yaml`과 `config/opencode.company.example.json`은 조사·환경 변수 매핑
참고자료일 뿐 runtime이 읽는 OpenCode config가 아니다. 특히 후자를 `OPENCODE_CONFIG`로
전달하거나 custom agent config로 복사하지 않는다. 회사 credential과 실제 경로는 Git에
넣지 않고 서버 환경 또는 회사 secret/config manager로 주입한다.

## 4. 사내 전환에서 교체할 부분

### A. 분석 source

simulator 저장소 안에 `ai-office-company-source-v1` extension을 구현한다. 정확한 export와
검증 규칙은 [Company 5+1 문서](./COMPANY_SEQUENTIAL_ANALYSIS.md)를 따른다.

- 설정된 repository root를 `realpath`로 고정한다.
- `.LLM`, DLD, TopView, source/test 경로를 각각 allowlist로 받는다.
- 요청과 관련된 파일만 검색하고 파일 수·개별 크기·총 snapshot 크기를 제한한다.
- symlink, `..`, absolute path 탈출을 거부한다.
- 결과 근거는 repository-relative path와 revision/digest로 남긴다.
- secret·credential·대용량 trace 원문은 snapshot 전에 필터링한다.

### B. 사내 OpenCode runtime

Company OpenCode runtime은 이미 구현돼 있다. 다음 경계를 수정하거나 우회하지 않고 회사
CLI에서 실제로 성립하는지 검증한다.

- provider는 `codemate`, 기본 모델은 `codemate/CodeLLMPro`이며 credential은 전용 `0600`
  auth 파일에서만 읽는다.
- 외부 Zen/Codex fallback을 금지한다.
- 모델은 서버의 역할별 allowlist 환경 변수만 받는다.
- `research → framework → estimate → test → git → orchestrator`를 정확히 한 번씩 순차 호출한다.
- 요청/snapshot/prior result는 `0600` 파일로 전달하고 CLI argv에는 넣지 않는다.
- 기본 인증 plugin은 유지하되 custom agent, `--agent`, `--pure`, MCP와 모든 tool은 금지한다.
- 긴 호출은 `preparing_context → calling_model → validating_output` phase와 시작 시각만
  progress callback으로 기록한다. chain-of-thought나 가짜 퍼센트는 노출하지 않는다.
- 기존 `PocModelOutput` schema와 role id는 유지한다.

### C. Claude coding runtime

현재 `LocalJobExecutor`는 Claude Code CLI용 기본 adapter다. 회사 Claude CLI가 호환되면
환경 설정만 교체하고, 다르면 `JobExecutionPort` 구현을 추가한다.

- coding packet은 분석 결과와 명시적 allowlist만 포함한다.
- 회사 profile에서만 실제 요청 원문을 전달한다.
- Claude는 업무 worktree만 수정하고 Commit/Push는 하지 않는다.
- 서버가 변경 경로, HEAD, symlink, bounded Diff를 다시 검증한다.
- 테스트 명령은 모델 출력이 아니라 서버의 command-id allowlist로 선택한다.
- 사내 모델 CLI에 filesystem sandbox가 있다면 OS sandbox와 함께 사용한다.

### D. 테스트와 Git

합성 Python 명령을 회사 simulator의 승인된 test command registry로 교체한다. 예:

```text
unit:ftl-buffer
integration:host-to-nand
regression:topview-scenario-17
```

command id만 job에 저장하고 실제 argv는 서버 설정에서 결정한다. 처음에는 `commit`까지만
허용하고, Push는 서비스 계정·branch protection·감사 정책 검증 후 켠다. main/master 직접
Push와 force-push/merge/delete는 계속 금지한다.

## 5. 역할별 모델 배정

[opencode.company.example.json](../config/opencode.company.example.json)은 runtime에 주입하는
파일이 아니라 역할별 서버 환경 변수 매핑 예시다.

```bash
export AI_OFFICE_MODEL_ORCHESTRATOR='codemate/CodeLLMPro'
export AI_OFFICE_MODEL_RESEARCH='codemate/CodeLLMPro'
export AI_OFFICE_MODEL_FRAMEWORK='codemate/CodeLLMPro'
export AI_OFFICE_MODEL_ESTIMATE='codemate/CodeLLMPro'
export AI_OFFICE_MODEL_TEST='codemate/CodeLLMPro'
export AI_OFFICE_MODEL_GIT='codemate/CodeLLMPro'
```

현재 POC UI는 실제 runtime이 사용한 분석/코딩 모델을 상태에 표시하고, 배정은 서버 설정으로
관리한다. 좌석별 UI 선택을 추가할 때는 다음 계약을 지킨다.

- capabilities가 허용 model catalog와 역할별 기본 catalog id를 반환한다.
- 브라우저는 임의 provider/model 문자열이 아니라 catalog id만 전송한다.
- 서버가 catalog id를 실제 model id로 변환하고 allowlist를 재검증한다.
- 생성 시 선택한 배정을 job에 snapshot하여 실행 도중 설정 변경 영향을 받지 않게 한다.

## 6. 운영 환경 예시

정확한 값은 회사 환경에 맞게 바꾼다.

```dotenv
NODE_ENV=production
AI_OFFICE_LOCAL_PROXY_ENABLED=1
AI_OFFICE_LOCAL_RUNNER_ENABLED=1
AI_OFFICE_DEPLOYMENT_MODE=internal
AI_OFFICE_INTERNAL_EXECUTION_ACK=on-prem-only
AI_OFFICE_BRIDGE_TOKEN=<웹과-bridge가-공유하는-64자리-hex-난수>

AI_OFFICE_AGENT_RUNTIME=opencode
AI_OFFICE_OPENCODE_PROFILE=company
AI_OFFICE_OPENCODE_BIN=/opt/company/bin/opencode
AI_OFFICE_OPENCODE_MODEL=codemate/CodeLLMPro
AI_OFFICE_COMPANY_PROVIDER_ALLOWLIST=codemate
AI_OFFICE_COMPANY_AUTH_FILE=/etc/ai-office/codemate-auth.json
AI_OFFICE_NIKE_ROOT=/srv/company-workspace/simulator
AI_OFFICE_EXTENSION_MODULE=/srv/company-workspace/simulator/deps/ai-office-source.mjs
AI_OFFICE_EXTENSION_MODULE_SHA256=<sha256-64-hex>
AI_OFFICE_COMPANY_DATA_ACK=protected-internal-only
AI_OFFICE_COMPANY_ACCESS_CONTROL_ACK=authenticated-private-server
AI_OFFICE_TRUSTED_PROXY_SECRET=<reverse-proxy와-공유하는-64-hex>
AI_OFFICE_COMPANY_ALLOWED_USER=<authenticated-single-user-id>

# 사내 coding JobExecutionPort를 포팅하기 전까지 0을 유지한다.
AI_OFFICE_CODING_ENABLED=0
AI_OFFICE_DATA_DIR=/var/lib/ai-office
AI_OFFICE_GIT_PUSH_ENABLED=0
```

실제 회사 source extension을 연결하기 전까지 OpenCode는 `zen` 합성 profile을 유지한다.
Company 분석 profile은 구현돼 있지만 source/auth/접근통제 조건이 하나라도 빠지면 fail-closed한다.
공개 저장소의 번들 `LocalJobExecutor`는 synthetic/macOS sandbox 전용이므로 internal profile을
의도적으로 거부한다. Linux 회사 서버에서는 승인된 rootless container 실행기를
`JobExecutionPort`로 연결한 뒤에만 coding을 활성화한다.

## 7. 사내 Claude에게 그대로 줄 프롬프트

```text
ai-office 저장소와 회사 simulator 저장소를 함께 분석해 줘.

먼저 다음 파일을 읽어:
- ai-office/docs/CLAUDE_COMPANY_INTEGRATION.md
- ai-office/docs/DUAL_OFFICE_WORKFLOW.md
- ai-office/config/agents.example.yaml
- ai-office/config/opencode.company.example.json

목표:
1. 현재 UI, /api/v1/jobs, Job state/digest/version 승인 계약을 유지한다.
2. 구현된 company 5+1 runtime은 유지하고 simulator 저장소 안에
   ai-office-company-source-v1 extension을 구현한다.
3. 실제 repository를 먼저 조사해 .LLM/DLD/TopView/common/FTL/FIL/HIL에 해당하는
   정확한 경로를 찾고 회사 설정으로 주입한다. 경로를 추측하거나 하드코딩하지 않는다.
4. codemate provider와 승인된 역할별 model만 사용한다. 외부 fallback은 금지한다.
5. 역할별 결과에 근거 파일 locator와 revision/digest를 남긴다.
6. Claude coding은 승인된 worktree와 경로에서만 실행한다.
7. 테스트는 server-owned command id allowlist로 실행한다.
8. Commit/Push는 기존 사람 승인 gate를 우회하지 않는다.
9. Git 이슈는 초안만 만들고 digest 기반 별도 승인/reconciliation 전에는 publish를 호출하지 않는다.

먼저 read-only로 두 저장소의 실제 구조, 회사 OpenCode CLI 사용법, 모델 ID, 테스트 명령,
Git 원격/branch 정책을 보고해. 확인되지 않은 값은 TODO로 남기고 작은 단계로 구현해.
회사 코드나 문서를 외부 모델로 보내지 마.
```

## 8. 완료 기준

- 외부 Zen을 끈 상태에서 사내 OpenCode로 분석이 완료된다.
- 여러 업무가 SQLite FIFO에 남고 새로고침·bridge 재시작 후 이어진다.
- DLD, TopView, 코드 분석 결과에 정확한 상대 경로와 revision 근거가 있다.
- 코드 분석/테스트 역할에 `CodeLLMPro` 등 허용 모델을 배정할 수 있다.
- 분석 패킷 승인 전 Claude 프로세스가 시작되지 않는다.
- Claude 변경은 업무 worktree와 승인된 경로 밖으로 나가지 않는다.
- 서버 테스트 통과와 변경 digest 승인 전 Commit/Push가 실행되지 않는다.
- 실패 단계·안전한 오류·재시도 여부가 좌석과 히스토리에 보인다.
- 앱 로그와 API에 token, credential, 절대 worktree 경로, stack trace가 노출되지 않는다.
- SSO/MFA, project 권한, 보존·백업·감사 정책이 운영 전에 적용된다.

## 9. 회사에서 먼저 확인할 값

- 회사 OpenCode/Claude CLI 버전과 non-interactive 실행 계약
- `CodeLLMPro`를 포함한 정확한 provider/model catalog
- simulator의 실제 `.LLM`, DLD, TopView, source/test 경로
- SystemC build/test command와 예상 실행 시간·자원 상한
- GitHub Enterprise/GitLab 주소, branch protection, 서비스 계정 권한
- 사내 모델 endpoint 외 egress 차단 여부
- 사용자 인증, project 권한, 데이터 보존·백업 요구사항
- 회사 서버 OS와 승인된 rootless container/runtime, 테스트 resource limit
