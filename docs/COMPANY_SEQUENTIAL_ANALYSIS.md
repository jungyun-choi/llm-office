# Company OpenCode 5+1 순차 분석

이 문서는 사내 OpenCode와 실제 simulator 자료를 AI Office에 붙일 때 지켜야 하는 실행
계약이다. 회사 자료를 처리하는 정식 진입점은 영속 Job API 하나뿐이다.

```text
POST /api/v1/jobs → 202 Accepted → SQLite analysis FIFO → analysis worker lane
  → research → framework → estimate → test → git → orchestrator
  → awaiting_coding_approval
```

legacy `POST /api/v1/poc/runs`는 동기 합성 POC 전용이다. 이 경로에는 company source
extension을 열어 주지 않으며 실제 회사 요청, 코드, 문서 또는 성능 데이터를 보내면 안 된다.

## 실행과 UI 계약

`POST /api/v1/jobs`는 모델 완료를 기다리지 않고 즉시 `202`와 Job DTO를 반환한다. 서버의
분석 worker lane이 SQLite 분석 대기열을 FIFO로 처리하므로 브라우저 연결이 끊겨도 분석은
계속된다. 개발 worker lane은 승인된 다른 업무를 동시에 처리할 수 있다. 같은 idempotency
key 재전송은 새 업무를 만들지 않는다.

각 업무는 아래 여섯 모델 턴을 정확히 한 번씩 순차 실행한다.

| 순서 | 역할 | 입력 | 출력 검증 |
|---:|---|---|---|
| 1 | `research` | 기능 요청 + source snapshot | 해당 역할의 `PocRoleOutput` |
| 2 | `framework` | + 검증된 research 결과 | 해당 역할의 `PocRoleOutput` |
| 3 | `estimate` | + 검증된 research/framework 결과 | 해당 역할의 `PocRoleOutput` |
| 4 | `test` | + 검증된 앞 세 결과 | 해당 역할의 `PocRoleOutput` |
| 5 | `git` | + 검증된 앞 네 결과 | 해당 역할의 `PocRoleOutput` |
| 6 | `orchestrator` | 검증된 다섯 결과 | `brief`와 `issueDraft` |

한 단계가 실패하면 뒤 단계는 실행하지 않는다. 모델 턴의 자동 retry는 **0회**이고 UI의
`attempt`는 `1`이다. 실패한 Job을 다시 시도하려면 사용자가 오류와 입력을 확인한 뒤 Job
action으로 명시적으로 재시도한다. 호출당 timeout은 최대 **1시간(3,600,000ms)**이며 전체
업무는 최악의 경우 여섯 호출만큼 걸릴 수 있다.

각 단계는 `pending → running → completed|failed`로 전이하고, `running` 안에서는 다음
검증 가능한 phase만 표시한다.

```text
preparing_context → calling_model → validating_output
```

Job worker는 `analysisStages` snapshot과 `startedAt`, `updatedAt`, `completedAt`, 안전한 요약을
SQLite에 저장한다. UI는 기존 `GET /api/v1/jobs` polling으로 현재 에이전트, `n/6`, 경과
시간과 실패 단계를 보여 준다. 모델 chain-of-thought나 추정 완료율은 노출하지 않는다.

## CompanyTurnExecutor 보안 계약

`CompanyTurnExecutor`는 한 역할당 OpenCode 프로세스 하나를 실행한다.

- 각 턴마다 별도의 `0700` HOME/XDG/tmp/workspace를 만들고 끝나면 제거한다.
- 전용 인증 파일에서 `codemate.key`만 읽어 격리된 `auth.json`에 `0600`으로 다시 쓴다.
- 각 턴마다 `INTERNAL_API_KEY`를 새로 주입한다.
- `OPENCODE_CONFIG_CONTENT`의 모든 tool과 permission을 끈다.
- codemate 인증 헤더 주입에 필요한 OpenCode 기본 plugin은 끄지 않는다.
- `OPENCODE_DISABLE_DEFAULT_PLUGINS`를 설정하지 않으며 `--agent`, `--pure`, 사용자 정의 agent
  config를 사용하지 않는다.
- 고정된 역할 지시만 CLI 인자로 전달하고 요청/snapshot/prior result는 `0600` 임시 파일로
  전달한다. process list에 회사 원문을 싣지 않는다.
- stdout/stderr 상한, JSON schema, 역할 일치, secret/stack trace/절대경로 출력 경계를 모두
  통과한 결과만 Job에 저장한다.

회사 prompt는 `poc/company-prompts/*.md`에 있다. 이전 역할 결과와 snapshot은
`UNTRUSTED_DATA_JSON`으로 취급하며 prompt나 정책으로 승격하지 않는다. `research`는 DLD와
`.LLM`, `framework`는 코드/모델링 경계, `estimate`는 TopView 흐름과 상대 공수, `test`는
정합성 테스트, `git`은 Claude 인계팩/이슈 초안을 맡는다.

## 인증 및 모델 설정

인증 원본은 공용 HOME의 OpenCode 인증 파일을 재사용하지 말고 전용 파일로 만든다.

```json
{"codemate":{"type":"api","key":"<company-key>"}}
```

```bash
install -o ai-office -g ai-office -m 0600 /dev/null /etc/ai-office/codemate-auth.json
# 승인된 비밀 배포 수단으로 위 JSON을 기록한 뒤 권한을 다시 확인한다.
stat -c '%a %U %G %n' /etc/ai-office/codemate-auth.json
```

`AI_OFFICE_COMPANY_AUTH_FILE`은 workspace 밖의 절대 경로여야 하고 실행 서비스 계정 소유,
권한 정확히 `0600`이어야 한다. top-level에는 codemate 항목 하나만 허용되며 다른 provider
credential이 함께 있으면 실행을 거부한다.

```dotenv
AI_OFFICE_AGENT_RUNTIME=opencode
AI_OFFICE_OPENCODE_PROFILE=company
AI_OFFICE_OPENCODE_BIN=/opt/company/bin/opencode
AI_OFFICE_COMPANY_AUTH_FILE=/etc/ai-office/codemate-auth.json

AI_OFFICE_COMPANY_PROVIDER_ALLOWLIST=codemate
AI_OFFICE_OPENCODE_MODEL=codemate/CodeLLMPro

# 생략한 역할은 AI_OFFICE_OPENCODE_MODEL을 사용한다.
AI_OFFICE_MODEL_RESEARCH=codemate/CodeLLMPro
AI_OFFICE_MODEL_FRAMEWORK=codemate/CodeLLMPro
AI_OFFICE_MODEL_ESTIMATE=codemate/CodeLLMPro
AI_OFFICE_MODEL_TEST=codemate/CodeLLMPro
AI_OFFICE_MODEL_GIT=codemate/CodeLLMPro
AI_OFFICE_MODEL_ORCHESTRATOR=codemate/CodeLLMPro
```

allowlist 밖 provider/model은 시작 전에 거부된다. company timeout은 고정된 턴당 1시간이며
`AI_OFFICE_AGENT_TIMEOUT_MS`로 더 늘어나지 않는다.

## 실제 repository source extension

AI Office는 `common/HIL/FTL/FIL` 같은 예시 경로를 고정하지 않는다. 사내 adapter가 실제
repository 구조와 `.LLM`, DLD, TopView를 조사해 요청에 필요한 최소 snapshot과
repository-relative evidence를 만든다. 전체 checkout, 절대경로, credential 또는 불필요한
원문을 snapshot/API 결과에 넣지 않는다.

source module은 `AI_OFFICE_NIKE_ROOT` 아래의 symlink가 아닌 단일 self-contained `.mjs`
파일이어야 하고 모든 환경에서 SHA-256 pin이 필수다. 검증된 bytes는 서비스 전용 임시
경로에 staging한 뒤 import하므로 상대 module import에 의존하지 않는다.

```dotenv
AI_OFFICE_NIKE_ROOT=/srv/company-workspace/nike_nvme
AI_OFFICE_EXTENSION_MODULE=/srv/company-workspace/nike_nvme/deps/ai-office-source.mjs
AI_OFFICE_EXTENSION_MODULE_SHA256=<sha256-64-hex>
```

adapter 계약:

```js
export const contractVersion = "ai-office-company-source-v1";

export async function createSimulatorSource() {
  return {
    id: "nike-nvme-readonly-source",
    async resolve({ featureRequest, signal }) {
      // featureRequest에 필요한 `.LLM`/DLD/TopView/코드 근거만 읽고 signal 중단을 따른다.
      return {
        sourceId: "nike-nvme-readonly-source",
        displayName: "Internal simulator snapshot",
        workingDirectory: "/srv/company-workspace/nike_nvme",
        outputSchemaPath: "/srv/company-workspace/nike_nvme/deps/poc-output.schema.json",
        policyNotice: "Approved internal read-only snapshot",
        snapshot: "<request-scoped JSON or Markdown with repository-relative evidence>",
        snapshotDigest: "<sha256(snapshot)>",
      };
    },
  };
}
```

예시의 `workingDirectory`와 `outputSchemaPath`는 신뢰 경계를 검사하기 위한 adapter 내부
절대경로다. 모델 입력에는 `sourceId`, snapshot digest와 snapshot만 전달되며 이 내부 경로는
Job API 결과로 직렬화하지 않는다.

module, root, working directory와 schema는 서비스 UID 또는 root 소유이고 group/world writable이
아니어야 한다. module/root/schema symlink, root 바깥 경로, snapshot digest 불일치와 크기 초과는
fail-closed한다. 기본 snapshot 상한은 4 MiB이며 `AI_OFFICE_COMPANY_SNAPSHOT_MAX_BYTES`로
64 KiB~16 MiB 사이에서만 조정한다.

## 실제 접근 통제와 ACK

아래 값은 인증 기능이 아니라 운영자가 이미 적용한 보호를 확인하는 fail-closed ACK다.
Company Job API는 인증 reverse proxy가 주입한 서버 비밀과 단일 사용자 신원을 별도로
검증한다. 웹은 loopback에 두고 다음 중 하나를 실제로 적용한다.

- Tailscale HTTPS/ACL 뒤의 reverse proxy에 개인 인증을 적용
- loopback 웹 앞에 사내 SSO/MFA reverse proxy와 project 권한 검사 배치
- 회사 방화벽, egress allowlist, 서비스 계정 최소 권한과 감사 로그 적용

그 다음에만 설정한다.

```dotenv
AI_OFFICE_COMPANY_DATA_ACK=protected-internal-only
AI_OFFICE_COMPANY_ACCESS_CONTROL_ACK=authenticated-private-server
AI_OFFICE_TRUSTED_PROXY_SECRET=<server-owned-64-hex>
AI_OFFICE_COMPANY_ALLOWED_USER=<authenticated-user-id>
```

production CLI 실행에는 다음 기존 이중 확인도 필요하다.

```dotenv
NODE_ENV=production
AI_OFFICE_DEPLOYMENT_MODE=internal
AI_OFFICE_INTERNAL_EXECUTION_ACK=on-prem-only
```

하나라도 빠지면 company capability와 source 로딩은 닫히는 것이 정상이다.

## IssuePublisher: 최종 사람 승인 뒤 등록

선택적인 Git 이슈 adapter 계약은 다음과 같다.

```js
export const contractVersion = "ai-office-company-issue-v1";
export async function createIssuePublisher() {
  return {
    async publish(result, { artifactDigest, idempotencyKey, commitSha, branchName, pushed }) {
      /* ... */
    },
  };
}
```

```dotenv
AI_OFFICE_ISSUE_PUBLISHER_MODULE=/srv/company-workspace/nike_nvme/deps/ai-office-issue.mjs
AI_OFFICE_ISSUE_PUBLISHER_MODULE_SHA256=<sha256-64-hex>
```

adapter는 신뢰 경로와 SHA-256 digest 검증을 통과해야 한다. 실제 `publish()` 호출은 코딩·테스트와
사람의 Git 승인까지 끝난 `completed` 시점에만 수행한다. `commit_and_push` 작업은 PR 최종 검토와
사람의 머지 승인이 끝나기 전까지 `review_pending`에 머물기 때문에 이슈가 먼저 등록되지 않는다.
성공한 `issueUrl`은 SQLite에 저장해 같은 Job 완료 처리가 중복 이슈를 만들지 않게 한다. publisher
실패는 코드 반영 결과를 되돌리지 않고 `issueError`로 화면에 표시한다.

## Claude에게 전달할 포팅 체크리스트

Claude에게 AI Office와 실제 simulator 저장소를 같은 workspace에서 보여 주되 먼저 read-only
조사를 시키고 다음 순서로 포팅한다.

- [ ] 실제 root와 `.LLM`/DLD/TopView/source/test 경로를 조사한다. 예시 디렉터리를 고정하지 않는다.
- [ ] `ai-office-company-source-v1` adapter가 분석용 최소 snapshot과 상대 근거만 반환한다.
- [ ] 전용 codemate auth 파일, provider allowlist와 여섯 역할 모델 ID를 회사 CLI로 검증한다.
- [ ] 기본 plugin 유지, tools false, 턴별 격리/auth staging, 1시간 timeout, 자동 retry 0을 보존한다.
- [ ] company 데이터는 Job API만 통과하고 legacy `/poc`와 Zen/Codex fallback은 닫힌다.
- [ ] `POST /jobs`가 즉시 202를 반환하고 FIFO/재시작/UI polling에서 여섯 단계가 보인다.
- [ ] 오류/결과/API에 secret, 절대경로, stack trace와 전체 checkout이 노출되지 않는다.
- [ ] Claude coding은 별도 승인, 전용 worktree, 실제 경로 allowlist와 server-owned test command로 교체한다.
- [ ] IssuePublisher는 digest-bound 승인과 중복 reconciliation 전까지 호출하지 않는다.

번들 `LocalJobExecutor`의 Claude coding은 synthetic 저장소 전용이다. 실제 simulator 코딩은
승인된 rootless container 또는 사내 `JobExecutionPort`로 포팅하기 전까지 fail-closed 상태를
유지한다.

## 검증 항목

- 정상: CLI 6회, 정해진 순서, 매번 새 runtime/auth/context 디렉터리
- 실패: estimate 실패 시 research/framework만 완료되고 뒤 단계는 pending
- 시간: 각 턴 1시간 제한, 자동 model retry 없음, HTTP 연결과 무관한 background 실행
- 저장/UI: 재조회와 새로고침에도 stage snapshot, `n/6`, 현재 역할과 오류 유지
- source: 실제 구조 기반 최소 snapshot, digest 일치, repository-relative evidence만 출력
- 보안: 기본 plugin 유지, tools/permission false, company credential과 절대경로 DTO 미노출
- 회귀: legacy `/poc`는 synthetic 전용이고 Zen/internal/Codex의 기존 계약은 유지
- publishing: 초안까지만 생성하며 실제 이슈는 생성되지 않음
