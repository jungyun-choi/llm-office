# 사내 개인 서버 운영 가이드

AI Office는 한 대의 서버에서 웹과 실행 브리지를 함께 운영한다. 프로세스는 두 개지만
사용자에게는 하나의 웹 서비스로 보인다.

```text
PC/모바일 브라우저
  → Vinext 웹 :3000
  → same-origin /api/v1/jobs
  → loopback bridge 127.0.0.1:4317
  → SQLite FIFO → OpenCode 분석 → 승인 → Claude 코딩 → 테스트 → 승인 → Git
```

브라우저는 OpenCode/Claude/Git을 직접 호출하지 않으며 bridge token과 모델 credential을
받지 않는다. `4317` 포트는 서버 밖에 절대 열지 않는다.

## 1. 가장 빠른 합성 POC

요구 사항:

- Node.js 22.13 이상
- `npm ci` 완료
- OpenCode 1.4.3과 사용할 Zen 모델
- Claude Code CLI
- Git과 Python 3
- Claude 코딩까지 시험할 때는 macOS와 `/usr/bin/sandbox-exec`

```bash
cd /srv/ai-office/current
npm ci
npm run build
npm run dev:office -- -H 127.0.0.1 -p 3000
```

같은 개인 tailnet의 모바일에서 직접 볼 때만 `127.0.0.1` 대신 서버의 정확한 Tailscale
IPv4를 사용한다. 공유 사내망에서는 웹도 loopback에 두고 SSO/MFA reverse proxy를 앞에 둔다.

```bash
npm run dev:office -- -H "$(tailscale ip -4)" -p 3000
```

`dev:office`는 다음 두 프로세스를 함께 시작하고 종료 신호도 함께 전달한다.

- `poc:bridge:office`: OpenCode Zen 분석, SQLite 큐, Claude/Git worker
- `dev:poc`: 웹과 same-origin loopback proxy

합성 profile은 사용자의 원문 대신 서버 소유 합성 시나리오를 외부 모델에 보낸다. 그래도
회사 요청, 코드, 문서, 경로, 성능 수치, 식별자나 비밀값은 입력하지 않는다.

## 2. 화면에서 검증할 흐름

1. 요청을 여러 건 등록하면 SQLite FIFO에 순서대로 남는다.
2. OpenCode 분석실이 한 건을 처리하고 `awaiting_coding_approval`에서 멈춘다.
3. 분석 패킷을 확인하고 **Claude에게 구현 맡기기**를 누른다.
4. Claude는 `ai-office/<job-id>` 브랜치의 전용 worktree에서만 수정한다.
5. 서버가 고정된 Python 테스트를 실행하고 `changes_ready`에서 멈춘다.
6. 변경 파일, Diff, 테스트 결과를 확인하고 **Commit 승인**을 누른다.
7. Push까지 켠 경우에만 **Commit + Push 승인**이 별도로 보인다.

업무와 이벤트 히스토리는 기본적으로 `~/.ai-office/jobs.sqlite`에 남는다. worktree는
`~/.ai-office/worktrees`에 생성된다. 이 디렉터리는 서비스 계정만 읽을 수 있게 `0700`,
DB는 `0600`으로 생성된다.

## 3. POC 환경 변수

`npm run dev:office`는 bridge token을 실행 시 한 번 생성해 두 child process에만 전달한다.
필요할 때만 아래 값을 덮어쓴다.

```dotenv
AI_OFFICE_DATA_DIR=/var/lib/ai-office
AI_OFFICE_BRIDGE_PORT=4317
AI_OFFICE_MAX_ACTIVE_JOBS=50

AI_OFFICE_OPENCODE_BIN=/var/lib/ai-office/.opencode/bin/opencode
AI_OFFICE_OPENCODE_MODEL=opencode/deepseek-v4-flash-free
AI_OFFICE_AGENT_TIMEOUT_MS=120000

AI_OFFICE_CLAUDE_BIN=/usr/local/bin/claude
AI_OFFICE_CLAUDE_MODEL=sonnet
AI_OFFICE_CLAUDE_TIMEOUT_MS=300000

# 기본값과 동일한 합성 저장소 최소 경계
AI_OFFICE_CODING_REPO=/srv/ai-office/current
AI_OFFICE_CODING_ALLOWED_PATHS=poc/simulator/src,poc/simulator/tests,poc/simulator/config

# 기본은 0. 합성 저장소에서 원격 브랜치까지 시험할 때만 1.
AI_OFFICE_GIT_PUSH_ENABLED=0
```

실행 파일 경로와 repository 경로는 절대 경로만 허용한다. 모델 ID와 허용 경로는 서버가
검증하고, 사용자가 입력한 임의 문자열을 shell 명령으로 사용하지 않는다.

번들 `LocalJobExecutor`는 synthetic 저장소와 macOS sandbox 전용이다. Linux 서버 또는 실제
회사 simulator에서는 분석 큐와 UI는 그대로 쓰되, Claude·테스트·Git 실행을 승인된 rootless
container 기반 `JobExecutionPort`로 교체하기 전까지 coding capability가 fail-closed하는 것이
정상이다.

## 4. 회사 OpenCode/Claude로 교체

회사 자료를 처리하는 경로는 `/api/v1/jobs`뿐이다. `POST /api/v1/poc/runs`는 계속
synthetic 전용이며 company source extension을 로드하지 않는다. 회사 자료를 열기 전에 다음을
모두 확인한다.

- 외부 Zen/Codex fallback이 꺼져 있다.
- OpenCode와 Claude가 회사 승인 endpoint/model만 사용한다.
- 회사 모델의 입력·출력 보존과 학습 정책이 승인되었다.
- 서버 egress가 회사 endpoint와 필요한 Git 원격으로 제한되었다.
- 웹은 loopback에 있고 개인 인증이 적용된 Tailscale/SSO reverse proxy 뒤에 있다.
- 실행 OS 계정은 simulator 저장소와 전용 데이터 디렉터리에만 필요한 권한을 가진다.

환경 변수를 설정하는 것만으로 접근 통제가 생기지 않는다. 먼저 Tailscale ACL 또는
SSO/MFA와 project 권한을 실제 적용한 뒤에만 아래 두 ACK를 켠다.

```dotenv
AI_OFFICE_COMPANY_DATA_ACK=protected-internal-only
AI_OFFICE_COMPANY_ACCESS_CONTROL_ACK=authenticated-private-server
AI_OFFICE_TRUSTED_PROXY_SECRET=<reverse-proxy와-공유하는-64자리-hex>
AI_OFFICE_COMPANY_ALLOWED_USER=<proxy가-확인한-단일-user-id>
```

회사 profile의 bridge 환경 예시는 다음과 같다. 실제 경로와 모델 ID는 사내에서 확인한
값으로 바꾼다.

```dotenv
NODE_ENV=production
AI_OFFICE_LOCAL_RUNNER_ENABLED=1
AI_OFFICE_DEPLOYMENT_MODE=internal
AI_OFFICE_INTERNAL_EXECUTION_ACK=on-prem-only
AI_OFFICE_BRIDGE_TOKEN=<웹과-bridge가-공유하는-64자리-hex-난수>
AI_OFFICE_COMPANY_DATA_ACK=protected-internal-only
AI_OFFICE_COMPANY_ACCESS_CONTROL_ACK=authenticated-private-server
AI_OFFICE_TRUSTED_PROXY_SECRET=<reverse-proxy와-공유하는-64자리-hex>
AI_OFFICE_COMPANY_ALLOWED_USER=<proxy가-확인한-단일-user-id>

AI_OFFICE_AGENT_RUNTIME=opencode
AI_OFFICE_OPENCODE_PROFILE=company
AI_OFFICE_OPENCODE_BIN=/opt/company/bin/opencode
AI_OFFICE_COMPANY_AUTH_FILE=/etc/ai-office/codemate-auth.json
AI_OFFICE_COMPANY_PROVIDER_ALLOWLIST=codemate
AI_OFFICE_OPENCODE_MODEL=codemate/CodeLLMPro

AI_OFFICE_MODEL_RESEARCH=codemate/CodeLLMPro
AI_OFFICE_MODEL_FRAMEWORK=codemate/CodeLLMPro
AI_OFFICE_MODEL_ESTIMATE=codemate/CodeLLMPro
AI_OFFICE_MODEL_TEST=codemate/CodeLLMPro
AI_OFFICE_MODEL_GIT=codemate/CodeLLMPro
AI_OFFICE_MODEL_ORCHESTRATOR=codemate/CodeLLMPro

AI_OFFICE_NIKE_ROOT=/srv/company-workspace/nike_nvme
AI_OFFICE_EXTENSION_MODULE=/srv/company-workspace/nike_nvme/deps/ai-office-source.mjs
AI_OFFICE_EXTENSION_MODULE_SHA256=<source-module-sha256-64-hex>

# 실제 coding executor 포팅 전에는 계속 0으로 둔다.
AI_OFFICE_CODING_ENABLED=0

AI_OFFICE_DATA_DIR=/var/lib/ai-office
AI_OFFICE_GIT_PUSH_ENABLED=0
```

전용 auth 파일은 workspace 밖의 절대 경로, 서비스 계정 소유, 정확히 `0600`이어야 한다.
공용 OpenCode `auth.json`을 가리키지 말고 codemate credential 하나만 넣는다.

```json
{"codemate":{"type":"api","key":"<company-key>"}}
```

source extension은 `AI_OFFICE_NIKE_ROOT` 아래의 self-contained `.mjs` 신뢰 파일이어야 하고
모든 환경에서 digest가 필수다. contract는 `ai-office-company-source-v1`, factory 이름은
`createSimulatorSource`다.
adapter가 전달된 `featureRequest`에 맞춰 실제 repository와 `.LLM`/DLD/TopView 구조를 읽어 분석용 최소 snapshot을
만들게 한다. `common/HIL/FTL/FIL`은 예시일 뿐 고정 경로로 가정하지 않는다. 근거는
repository-relative로 만들고 전체 checkout, 절대경로, credential을 결과/API에 노출하지 않는다.

역할별 모델 변수는 생략하면 `AI_OFFICE_OPENCODE_MODEL`로 돌아간다. provider allowlist 밖
모델은 거부된다. company 분석은 `research → framework → estimate → test → git →
orchestrator` 여섯 턴을 순차 실행하고 호출당 최대 1시간, 자동 model retry 0회다. 각 턴은
분리된 HOME/XDG와 auth staging을 사용한다. `OPENCODE_CONFIG_CONTENT`의 tools는 모두 false이며
codemate 인증에 필요한 기본 plugin을 끄면 안 된다. 특히 `OPENCODE_DISABLE_DEFAULT_PLUGINS`를
설정하지 않는다.

분석 요청은 `POST /api/v1/jobs`에서 즉시 `202`를 받은 뒤 SQLite FIFO background worker가
처리한다. 화면에는 현재 역할, 내부 phase, `n/6`, 경과 시간과 오류가 polling으로 표시된다.

한 서버에서 직접 확인하려면 company 환경을 export한 뒤 한 명령으로 loopback bridge와 웹을
함께 띄울 수 있다. `dev:office`는 `AI_OFFICE_OPENCODE_PROFILE=company`를 감지해
`poc:bridge:company`를 선택하고 두 child process에 같은 임시 bridge token을 전달한다.

```bash
set -a
. /etc/ai-office/bridge.env
set +a
cd /srv/ai-office/current
npm run dev:office -- -H 127.0.0.1 -p 3000
```

Company 모드에서는 웹 bind도 `127.0.0.1`을 유지한다. 앞단의 Tailscale HTTPS 또는 사내
SSO/MFA reverse proxy는 외부에서 들어온 `X-AI-Office-*` 헤더를 먼저 제거하고, 인증 성공 후
`X-AI-Office-Trusted-Proxy`에 위 서버 비밀, `X-AI-Office-User`에 허용된 단일 user id를 새로
주입해야 한다. 둘 중 하나라도 다르면 Job API는 `401`로 닫힌다. bridge `4317`도 항상
loopback이다. systemd처럼 웹과 bridge를 따로 운영할 때는 같은 token을 두
환경 파일에 넣고 bridge에는 `npm run poc:bridge:company`, 웹에는 `npm run dev:poc`를 사용한다.

예를 들어 인증을 완료한 reverse proxy의 upstream 설정은 다음 형태다. 실제 TLS/SSO 또는
Basic Auth 설정은 회사 정책을 사용하고, 아래 secret literal이 들어간 파일은 root `0600`으로
보호한다.

```nginx
location / {
    # auth_basic 또는 사내 auth_request가 먼저 성공해야 한다.
    proxy_set_header X-AI-Office-Trusted-Proxy "<AI_OFFICE_TRUSTED_PROXY_SECRET>";
    proxy_set_header X-AI-Office-User $remote_user;
    proxy_pass http://127.0.0.1:3000;
}
```

reverse proxy가 같은 이름의 client header를 그대로 전달하면 안 된다. `bridge.env`와
`web.env`에는 bridge token뿐 아니라 같은 trusted-proxy secret과 allowed user도 넣는다.

현재 공개 저장소는 company OpenCode 분석 executor와 source extension 계약을 포함한다.
반면 번들 Claude `LocalJobExecutor`는 여전히 synthetic 저장소/macOS sandbox 전용이다. 실제
simulator 코딩은 승인된 rootless-container `JobExecutionPort`와 실제 테스트 command ID,
worktree/경로 allowlist를 포팅하기 전까지 `AI_OFFICE_CODING_ENABLED=0`으로 둔다.

Git IssuePublisher는 `ai-office-company-issue-v1`과 `createIssuePublisher` factory 연결점만
있다. module/digest 검증이 되더라도 실제 `publish()`는 호출되지 않고 이슈 초안만 보존된다.
artifact digest에 묶인 사람 승인과 idempotency 중복 조회/reconciliation을 구현하기 전까지
자동 등록을 켜지 않는다. 전체 adapter와 Claude 포팅 체크리스트는
[Company 5+1 순차 분석](./COMPANY_SEQUENTIAL_ANALYSIS.md)을 따른다.

## 5. systemd 예시

비밀값은 Git이나 unit 본문에 넣지 말고 root 소유 `0600` 환경 파일에 둔다. 다음처럼 token을
한 번 만들고 같은 값을 `bridge.env`와 `web.env` 양쪽에 넣는다.

```bash
openssl rand -hex 32
```

```dotenv
AI_OFFICE_BRIDGE_TOKEN=<위에서-만든-64자리-hex>
```

`/etc/systemd/system/ai-office-bridge.service`:

```ini
[Unit]
Description=AI Office loopback execution bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ai-office
Group=ai-office
WorkingDirectory=/srv/ai-office/current
EnvironmentFile=/etc/ai-office/bridge.env
ExecStart=/usr/bin/npm run poc:bridge:company
Restart=on-failure
RestartSec=5s
KillMode=control-group
TimeoutStopSec=15s
MemoryMax=6G
OOMPolicy=stop
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/ai-office-web.service`:

```ini
[Unit]
Description=AI Office web
After=ai-office-bridge.service
Wants=ai-office-bridge.service

[Service]
Type=simple
User=ai-office
Group=ai-office
WorkingDirectory=/srv/ai-office/current
EnvironmentFile=/etc/ai-office/web.env
ExecStart=/usr/bin/npm run dev:poc -- -H 127.0.0.1 -p 3000
Restart=on-failure
RestartSec=5s
UMask=0077
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

회사 production에서는 build/start 구성을 배포 환경에 맞게 검증하고, bridge token과
production 이중 확인 변수를 웹과 bridge 양쪽에 동일하게 공급한다. token은 capability 또는
브라우저 응답으로 조회할 수 없으며 누락되면 서버가 시작/중계를 거부한다.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ai-office-bridge.service ai-office-web.service
sudo systemctl status ai-office-bridge.service ai-office-web.service
```

## 6. 상태 확인과 운영

```bash
# 4317은 loopback에만, 3000은 의도한 주소에만 떠야 한다.
ss -ltnp | grep -E ':(3000|4317)\b'

# 브라우저가 호출하는 same-origin 기능 확인
curl -fsS http://127.0.0.1:3000/api/v1/jobs/capabilities

# 대기열과 히스토리 확인
curl -fsS 'http://127.0.0.1:3000/api/v1/jobs?limit=10&offset=0'

journalctl -u ai-office-web.service -u ai-office-bridge.service -f
```

capabilities에서 확인할 값:

- `queue.persistent=true`, `queue.storage=sqlite`, `queue.maxActiveJobs=50`(기본 대기열 상한)
- `analysis.available=true`
- company 분석에서는 `dataPolicy.syntheticOnly=false`, 보호 조건을 모두 만족하면
  `dataPolicy.acceptsCompanyData=true`
- 번들 coding을 아직 포팅하지 않았다면 `coding.enabled=false`가 정상
- 합성 coding POC에서만 `coding.enabled=true`, `coding.available=true`
- 합성 POC에서는 `dataPolicy.syntheticOnly=true`
- 기본값은 `publishing.pushEnabled=false`

## 7. 장애 대응

| 증상 | 확인할 것 |
|---|---|
| 화면이 서버 연결 실패 | 웹과 bridge 상태, `AI_OFFICE_LOCAL_PROXY_ENABLED=1`, 4317 중복 점유 |
| `BRIDGE_TOKEN_MISSING` | 웹/bridge 환경 파일의 `AI_OFFICE_BRIDGE_TOKEN` 값과 권한, 두 값의 일치 여부 |
| 분석 runtime unavailable | OpenCode 절대 경로·버전·model catalog·회사 provider 인증 |
| Claude 승인 버튼 비활성 | `AI_OFFICE_CODING_ENABLED=1`, Claude 실행 파일과 profile 정책 |
| 업무가 `failed` | 화면의 안전한 오류 code/stage, bridge 로그, 재시도 가능 여부 |
| 테스트 실패 | 변경 Diff와 고정 테스트 출력 확인 후 수정 업무를 다시 요청 |
| Commit은 됐지만 Push 실패 | job의 commit SHA 확인 후 credential/branch 권한을 고치고 재시도 |
| 재시작 후 실행 중 업무 중단 | 안전하게 `failed`로 복구; 확인 후 명시적 retry, 대기 업무는 FIFO 유지 |
| 디스크 증가 | 완료 worktree 보존 정책을 확인하고 승인된 정리 절차 사용 |

앱 자체에는 아직 다중 사용자 계정·업무별 ACL이 없다. Company 모드는 위 인증 reverse
proxy의 단일 사용자만 허용하며, 이를 우회해 웹 포트를 공유망에 노출하지 않는다. 백업 시
`jobs.sqlite`뿐 아니라 WAL 파일도 일관된 SQLite 백업
절차로 다룬다. 현재 POC는 업무 원문·결과·Diff와 worktree를 자동 만료시키지 않으므로 실제
회사 자료를 열기 전에 보존 TTL, 암호화, 삭제·백업 정책과 정리 worker를 추가한다.
