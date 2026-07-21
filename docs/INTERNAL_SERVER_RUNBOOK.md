# 사내 개인 Linux 서버 운영 가이드

이 문서는 현재 저장소 그대로 실행 가능한 **합성 POC**와, 아직 구현이 필요한 **회사 데이터 연동판**을 구분한다. 예시는 전용 OS 계정 `ai-office`, 설치 경로 `/srv/ai-office/current`, Node.js `22.13.0` 이상, systemd를 기준으로 한다.

## 먼저 확인할 현재 상태

| 경로 | 지금 실행 가능 | 웹/실행기 | 데이터와 대기열 |
|---|---:|---|---|
| A. 합성 POC | 예 | `dev:poc` 웹 + `127.0.0.1:4317` Zen bridge | 합성 저장소만 사용. 큐·히스토리는 브라우저별 `localStorage`(실행/대기 10건, 완료/실패 20건) |
| B. 회사 연동판 | 아니요 | 향후 production 웹 + 회사 runtime/worker | `InternalSimulatorSource`와 서버 영속 FIFO가 아직 연결되지 않음 |

현재 `npm run start`는 production 웹을 띄우지만 로컬 bridge proxy를 의도적으로 비활성화한다. 따라서 경로 A는 `npm run dev:poc`를 사용해야 한다. 또한 현재 `poc:bridge:opencode-internal`은 **로컬 Ollama provider만 허용**하고 여전히 `SyntheticSimulatorSource`를 사용한다. 회사 endpoint나 실제 저장소가 연결됐다는 뜻이 아니다.

현재 별도 범용 backend 앱은 없다. 웹 프로세스 안의 same-origin API와 별도 OpenCode
bridge가 backend 역할을 나누므로, 합성 POC에서는 아래 두 프로세스만 실행한다.

## 가장 빠른 수동 실행

```bash
cd /srv/ai-office/current
npm ci

# 터미널 1: 합성 데이터 전용 OpenCode Zen bridge
npm run poc:bridge

# 터미널 2: 같은 서버의 인증 reverse proxy 뒤에서 실행
npm run dev:poc -- -H 127.0.0.1 -p 3000
```

개인 tailnet에서 소유자 단말만 ACL로 허용했다면 두 번째 명령의 host만 서버의 정확한
Tailscale IPv4로 바꾼다. 회사 자료는 아직 입력하지 않는다.

## A. 현재 합성 POC 실행

회사 요청, 코드, Wiki, 실제 성능 수치, 경로, 식별자를 입력하지 않는다. `npm run poc:bridge`는 외부 OpenCode Zen으로 합성 snapshot을 보내는 예외 경로다. 회사 정책이 외부 AI egress를 금지하면 이 경로도 실행하지 않는다.

### 1. 설치와 사전 검증

Node.js와 npm은 systemd에서도 보이는 시스템 경로에 설치하는 편이 안전하다. OpenCode는 저장소가 검증하는 정확한 버전 `1.4.3`을 전용 서비스 계정 소유 파일로 설치한다.
checkout과 `npm ci`/build도 `ai-office` 계정으로 실행해 root 소유 `node_modules`나 build 산출물이 생기지 않게 한다.

```bash
sudo install -d -o ai-office -g ai-office -m 0700 /var/lib/ai-office
sudo -u ai-office -H node --version                 # v22.13.0 이상
sudo -u ai-office -H npm --version
sudo -u ai-office -H npm --prefix /srv/ai-office/current ci
sudo -u ai-office -H npm --prefix /srv/ai-office/current run build
# vinext와 tsx가 devDependency이므로 npm ci에 --omit=dev 금지
# build는 배포 전 검증이며 bridge 연결 실행은 아래 dev:poc 사용

sudo -u ai-office -H /var/lib/ai-office/.opencode/bin/opencode --version
# 정확히 1.4.3이어야 함
sudo -u ai-office env \
  HOME=/var/lib/ai-office \
  XDG_CONFIG_HOME=/var/lib/ai-office/.config \
  XDG_DATA_HOME=/var/lib/ai-office/.local/share \
  XDG_CACHE_HOME=/var/lib/ai-office/.cache \
  /var/lib/ai-office/.opencode/bin/opencode models opencode

sudo -u ai-office test -r /var/lib/ai-office/.cache/opencode/models.json
stat -c '%U %G %a %n' /var/lib/ai-office/.cache/opencode/models.json
```

마지막 명령은 Zen model catalog를 갱신한다. catalog는 7일보다 오래되면 bridge가 unavailable로 닫힌다. OpenCode 실행 파일은 `ai-office` 계정 소유이고 group/world writable이 아니어야 한다.
catalog도 `ai-office` 소유이며 group/world writable이 아니어야 한다.

### 2. 환경 파일

비밀값과 사내 endpoint는 Git 저장소나 unit 파일에 넣지 않는다. systemd가 root로 읽는 별도 파일을 만든다.

```bash
sudo install -d -m 0750 /etc/ai-office
sudo touch /etc/ai-office/web.env /etc/ai-office/bridge.env
sudo chown root:root /etc/ai-office/web.env /etc/ai-office/bridge.env
sudo chmod 0600 /etc/ai-office/web.env /etc/ai-office/bridge.env
```

`touch`는 기존 환경 파일 내용을 지우지 않는다. 아래 예시는 최초 작성 시에만 편집하고,
운영 중에는 회사 secret manager 또는 승인된 변경 절차로 갱신한다.

`/etc/ai-office/web.env`:

```dotenv
AI_OFFICE_WEB_HOST=127.0.0.1
AI_OFFICE_WEB_PORT=3000
AI_OFFICE_PUBLIC_ORIGIN=https://ai-office.example.internal
```

- reverse proxy를 쓰면 `127.0.0.1`을 유지한다.
- 직접 tailnet에 열 때만 `AI_OFFICE_WEB_HOST`를 서버의 **정확한 Tailscale IPv4**로 바꾼다. `0.0.0.0`은 사용하지 않는다.
- `AI_OFFICE_PUBLIC_ORIGIN`은 HTTPS origin 또는 loopback HTTP만 허용한다. 직접 Tailscale IP의 HTTP 주소에서는 생략해도 앱 실행에는 영향이 없고, 소셜 메타데이터만 기본값을 사용한다.

`/etc/ai-office/bridge.env`:

```dotenv
AI_OFFICE_BRIDGE_PORT=4317
AI_OFFICE_OPENCODE_BIN=/var/lib/ai-office/.opencode/bin/opencode
AI_OFFICE_OPENCODE_HOME=/var/lib/ai-office
XDG_CONFIG_HOME=/var/lib/ai-office/.config
XDG_DATA_HOME=/var/lib/ai-office/.local/share
XDG_CACHE_HOME=/var/lib/ai-office/.cache
AI_OFFICE_OPENCODE_MODEL=opencode/deepseek-v4-flash-free
AI_OFFICE_AGENT_TIMEOUT_MS=120000
```

`AI_OFFICE_BRIDGE_PORT`는 바꾸지 않는다. 웹 프록시가 `127.0.0.1:4317`로 고정돼 있고 bridge 자체도 항상 loopback에 bind한다. 토큰이나 provider credential이 필요해지면 같은 `0600` 파일 또는 회사 secret manager에서 주입한다.

### 3. systemd 두 프로세스

아래 `/usr/bin/npm`은 서버의 `command -v npm` 결과와 다르면 교체한다.

`/etc/systemd/system/ai-office-bridge.service`:

```ini
[Unit]
Description=AI Office synthetic POC loopback bridge
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ai-office
Group=ai-office
WorkingDirectory=/srv/ai-office/current
EnvironmentFile=/etc/ai-office/bridge.env
ExecStart=/usr/bin/npm run poc:bridge
Restart=on-failure
RestartSec=5s
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

`/etc/systemd/system/ai-office-web.service`:

```ini
[Unit]
Description=AI Office synthetic POC web
After=network-online.target ai-office-bridge.service
Wants=network-online.target ai-office-bridge.service

[Service]
Type=simple
User=ai-office
Group=ai-office
WorkingDirectory=/srv/ai-office/current
EnvironmentFile=/etc/ai-office/web.env
ExecStart=/usr/bin/npm run dev:poc -- -H ${AI_OFFICE_WEB_HOST} -p ${AI_OFFICE_WEB_PORT}
Restart=on-failure
RestartSec=5s
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ai-office-bridge.service ai-office-web.service
sudo systemctl status ai-office-bridge.service ai-office-web.service
```

### 4. 네트워크와 health check

현재 웹 UI와 `/api/v1/poc/*`에는 애플리케이션 로그인 기능이 없다. 따라서 다음 조건을
만족하지 않는 사내망이나 공유 tailnet에 웹 포트를 직접 노출하면 안 된다.

권장 노출 방식은 다음 둘 중 하나다.

1. **단일 사용자 POC만**: 소유자 단말만 가입된 개인 tailnet에서 웹을 정확한 Tailscale
   IP에 bind하고, tailnet ACL과 호스트 방화벽이 그 단말만 `3000/tcp`에 허용할 때 사용한다.
2. **공유 tailnet 또는 사내망**: 웹을 `127.0.0.1:3000`에 유지한다. HTTPS reverse proxy가
   `/`와 `/api/v1/poc/*` 전체에 회사 SSO/MFA를 적용한 뒤에만 외부에 노출한다.

`dev:poc`는 장기 production 서버가 아니라 개인 합성 POC용이다. 여러 사용자가 쓰거나 회사
자료를 처리하기 전에는 B 경로의 인증된 production 웹과 서버 영속 backend를 먼저 구현한다.

어느 경우든 `4317/tcp`는 방화벽에서 열지 않는다. 다음 결과에서 `4317`은 `127.0.0.1`에만, 웹 `3000`은 선택한 주소에만 떠야 한다.

```bash
sudo ss -ltnp | grep -E ':(3000|4317)\b'

# bridge token을 출력하지 않는 loopback 검사
curl -fsS http://127.0.0.1:4317/api/v1/poc/capabilities \
  | jq -e '{apiVersion, environment, agentRuntime, dataPolicy}'

# reverse proxy/loopback 구성 예시
curl -fsS http://127.0.0.1:3000/api/v1/poc/capabilities \
  | jq -e '.environment == "local" and .agentRuntime.enabled == true and .agentRuntime.available == true'
```

마지막 검사가 `true`이면 웹 → same-origin API → loopback bridge가 연결된 상태다. 실제 접속 주소에서도 `/api/v1/poc/capabilities`와 합성 요청 1건을 확인한다.

### 5. 로그, 재시작, 업데이트와 rollback

```bash
journalctl -u ai-office-web.service -u ai-office-bridge.service -f
sudo systemctl restart ai-office-bridge.service ai-office-web.service
```

업데이트는 승인된 commit을 새 release 디렉터리에 checkout하고 그 안에서 `npm ci`, `npm run build`, health 검증을 끝낸 다음 `/srv/ai-office/current` symlink를 원자적으로 바꾸고 두 서비스를 재시작한다. 이전 release 디렉터리는 즉시 지우지 않는다. 장애 시 symlink를 이전 release로 되돌리고 같은 두 서비스를 재시작한다. 최소한 아래 값은 배포 기록에 남긴다.

```bash
git -C /srv/ai-office/current rev-parse HEAD
node --version
/var/lib/ai-office/.opencode/bin/opencode --version
```

## B. 향후 회사 OpenCode + InternalSimulatorSource

이 경로는 현재 배포 절차가 아니라 **구현 완료 전 차단 목록**이다. 지금 코드에는 `InternalRepoSource` 골격이 있지만 `PocRunService`가 `SyntheticSimulatorSource`를 직접 생성한다. `config/agents.example.yaml`과 `config/opencode.company.example.json`도 예시일 뿐 런타임에 연결되지 않았다. 서버 영속 job API, database/queue worker, 다중 사용자 인증·감사도 아직 없다.

실제 회사 자료를 열기 전에 다음을 모두 구현·검증한다.

- `InternalSimulatorSource`를 승인된 read-only root allowlist와 최소 snapshot 생성 로직에 연결한다.
- 외부 Zen fallback을 제거하고, 회사가 승인한 OpenCode endpoint/provider/model만 서버 allowlist로 검증한다. 현재 internal profile의 Ollama 전용 제한도 회사 profile로 명시적으로 교체한다.
- `config/agents.company.yaml`, `config/opencode.company.json`은 Git 밖의 `0600` 파일 또는 secret/config manager로 공급한다. endpoint credential은 문서나 저장소에 기록하지 않는다.
- 외부 provider egress를 기본 거부하고 회사 endpoint, Git/Wiki 등 승인 목적지만 허용한다. 회사 데이터에는 Zen/Codex 경로를 사용하지 않는다.
- 브라우저 `localStorage` 큐를 `POST /api/v1/jobs` 기반 서버 영속 FIFO와 단일 worker로 교체한다. 재시작 복구, idempotency, 사용자/project 권한, 취소, pagination, 보존 기간, 안전한 agent error event를 구현한다.
- 회사 SSO/MFA, `Cache-Control: no-store`, 감사 로그, 암호화 저장소와 사람 승인 전 Git publish 금지를 적용한다.

이 구현이 끝나면 웹은 `npm run build` 후 `npm run start -- -H 127.0.0.1 -p 3000`으로 운영하고 reverse proxy 뒤에 둔다. durable worker/backend는 별도 systemd unit으로 실행해야 하지만, **현재 `package.json`에는 그 실행 script가 없으므로 지금 만들 수 있는 유효한 unit 명령도 없다.** 구현 시 실제 추가된 script와 health endpoint를 기준으로 이 문서를 갱신한다.

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| 웹은 뜨지만 deterministic demo만 보임 | `npm run start`를 쓴 것은 아닌지 확인. bridge 연결 POC는 `dev:poc`만 지원 |
| `LOCAL_RUNNER_UNAVAILABLE` | bridge service 상태, OpenCode `1.4.3`, 실행 파일 소유권/권한, 7일 이내 model catalog 확인 |
| 웹 capabilities가 `hosted` | web unit에 `dev:poc`가 아닌 `dev`/`start`를 썼거나 proxy flag가 빠짐 |
| bridge 직접 호출이 403 | `127.0.0.1`에서 호출했는지, `Host`가 `127.0.0.1:4317` 또는 `localhost:4317`인지 확인 |
| `EADDRINUSE` | `sudo ss -ltnp`로 3000/4317 점유 프로세스를 찾고 중복 unit 실행을 정리 |
| systemd에서만 OpenCode unavailable | `AI_OFFICE_OPENCODE_BIN` 절대 경로, 서비스 계정 소유 여부, unit의 환경 파일 권한 확인 |
| 재부팅 후 업무가 사라짐 | 현재 큐는 서버가 아니라 해당 브라우저의 `localStorage`; durable queue는 미구현 |

회사 연동 설계와 보안 조건은 [Claude용 사내 연동 인계서](./CLAUDE_COMPANY_INTEGRATION.md), [아키텍처](./ARCHITECTURE.md), [보안 경계](./SECURITY.md)를 함께 따른다.
