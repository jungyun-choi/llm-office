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

회사 자료를 열기 전에 다음을 모두 확인한다.

- 외부 Zen/Codex fallback이 꺼져 있다.
- OpenCode와 Claude가 회사 승인 endpoint/model만 사용한다.
- 회사 모델의 입력·출력 보존과 학습 정책이 승인되었다.
- 서버 egress가 회사 endpoint와 필요한 Git 원격으로 제한되었다.
- 웹은 회사 SSO/MFA reverse proxy 뒤에 있다.
- 실행 OS 계정은 simulator 저장소와 전용 데이터 디렉터리에만 필요한 권한을 가진다.

회사 profile의 최소 환경 예시는 다음과 같다.

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
AI_OFFICE_OPENCODE_MODEL=company/CodeLLMPro

AI_OFFICE_CODING_ENABLED=1
AI_OFFICE_CLAUDE_PROFILE=internal
AI_OFFICE_CLAUDE_BIN=/opt/company/bin/claude
AI_OFFICE_CLAUDE_MODEL=company-code-model
AI_OFFICE_CODING_REPO=/srv/simulator
AI_OFFICE_CODING_ALLOWED_PATHS=common,FTL,FIL,HIL,tests

AI_OFFICE_DATA_DIR=/var/lib/ai-office
AI_OFFICE_GIT_PUSH_ENABLED=0
```

`AI_OFFICE_DEPLOYMENT_MODE`와 `AI_OFFICE_INTERNAL_EXECUTION_ACK`는 production에서 CLI
실행을 여는 이중 확인이다. 둘 중 하나라도 없으면 proxy/coding은 닫혀야 한다. 실제 회사
경로는 예시와 다를 수 있으므로 먼저 repository를 조사해 allowlist를 정확히 설정한다.

현재 공개 저장소의 OpenCode 설정은 `internal|zen`만, 번들 coding executor는
`synthetic`만 지원한다. 따라서 위 `company` 분석 profile과 `internal` coding profile은
사내 `SequentialTurnExecutor`, `InternalSimulatorSource`, rootless-container
`JobExecutionPort`가 연결된 branch에서만 활성화한다. 공개 골격만 Linux 서버에 올리면
회사 adapter를 추측해 실행하지 않고 fail-closed하는 것이 정상이다.

현재 합성 분석 source는 `SyntheticSimulatorSource`다. `.LLM`, DLD, TopView와 실제 코드
근거를 사용하려면 [Claude 사내 연동 인계서](./CLAUDE_COMPANY_INTEGRATION.md)에 따라
`InternalSimulatorSource`와 회사 OpenCode adapter를 연결한다. UI와 `/api/v1/jobs` 상태
계약은 유지한다.

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
ExecStart=/usr/bin/npm run poc:bridge:internal
Restart=on-failure
RestartSec=5s
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
- `coding.enabled=true`, `coding.available=true`
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
| 재시작 후 실행 중 업무 중단 | 안전하게 `failed`로 복구되며 retry; 대기 업무는 FIFO 유지 |
| 디스크 증가 | 완료 worktree 보존 정책을 확인하고 승인된 정리 절차 사용 |

앱 자체에는 아직 다중 사용자 인증이 없다. 개인 tailnet ACL 또는 SSO/MFA reverse proxy 없이
공유망에 노출하지 않는다. 백업 시 `jobs.sqlite`뿐 아니라 WAL 파일도 일관된 SQLite 백업
절차로 다룬다. 현재 POC는 업무 원문·결과·Diff와 worktree를 자동 만료시키지 않으므로 실제
회사 자료를 열기 전에 보존 TTL, 암호화, 삭제·백업 정책과 정리 worker를 추가한다.
