# AI Office

SSD/UFS 성능 시뮬레이터 팀의 기능 요청을 **조사하고, 견적 내고, 테스트를 설계하고, Git 이슈 초안으로 정리하는** AI 운영실의 첫 번째 골격입니다.

이 프로젝트의 핵심 원칙은 두 가지입니다.

1. AI Office는 우선 코드를 직접 수정하지 않습니다. 구현 전에 필요한 근거와 실행 계획을 품질 좋게 만드는 데 집중합니다.
2. 사내 코드, 설계 문서, 성능 데이터의 원문과 이를 복원할 수 있는 파생물은 보안 경계 밖으로 보내지 않습니다. 사내 커넥터가 원문을 읽고, 정책·DLP·사람 승인을 모두 통과한 최소 메타데이터만 조건부로 전달합니다.

## 현재 포함된 것

- 오케스트레이터에게 자연어로 일을 맡기는 단일 입력창
- 여러 업무를 계속 맡기면 한 건씩 처리하는 POC용 FIFO 대기열
- 최근 20건의 완료·실패 히스토리와 에이전트 오류 표시
- 여섯 에이전트의 좌석, 상태, 업무 전달을 보여주는 디지털 사무실
- DLD 조사 → 코드/모델 분석 → TopView 영향/견적 → 테스트 → Claude 인계 흐름
- 완료된 브리프를 읽을 수 있는 결과 보관함
- 회사 정보가 전혀 없는 작은 `Synthetic FlashSim`과 합성 Wiki
- Codex, OpenCode, 결정적 데모를 교체할 수 있는 `AgentRuntime` 계약
- 합성 저장소와 향후 사내 커넥터를 교체할 수 있는 `SimulatorSource` 계약
- 사내망 커넥터, 데이터 계약, 승인 게이트를 설명하는 아키텍처 문서
- 위협 모델과 실제 도입 체크리스트를 담은 보안 문서

배포된 화면은 항상 안전한 합성 결과를 사용합니다. 로컬에서 명시적으로 브리지를 실행한 경우에만 Codex 또는 OpenCode가 합성 저장소를 분석합니다. 실제 연동 단계에서는 UI를 다시 만드는 대신 두 플러그인을 사내 구현으로 교체합니다.

현재 화면의 대기열과 히스토리는 단일 브라우저 POC를 위한 `localStorage` 구현입니다. 사내 버전에서는 프롬프트를 브라우저에 저장하지 않고, [회사 연동 가이드](./docs/CLAUDE_COMPANY_INTEGRATION.md)의 서버 영속 FIFO로 교체해야 합니다.

## 에이전트 팀

| 에이전트 | 책임 | 기본 권한 |
|---|---|---|
| 오비트 | 요청 분해와 최종 Claude 인계팩 통합 | 업무 배정/결과 통합 |
| DLD · 위키 | `.LLM`, DLD, 디버깅 기록에서 상세 스펙 수집 | 사내 문서 읽기 |
| 코드 · 모델링 | `common`, FTL, FIL, HIL 수정 지점과 성능 모델 영향 분석 | 코드/문서 읽기 |
| TopView · 영향/견적 | 커맨드별 패킷 흐름, 의존성, 상대 공수 정리 | 분석 산출물 쓰기 |
| 테스트 | 기능·회귀·성능 모델 정합성 테스트와 수용 기준 작성 | 테스트 계획 쓰기 |
| Claude · Git | Claude 코딩 인계팩과 Git 이슈 초안 작성 | 초안 작성, 승인 후 등록 |

## 안전한 연동 방식

권장 기본형은 **사내 실행 커넥터 + 제어용 웹 사무실**의 분리입니다.

```text
[사내 Git / LLM Wiki / Simulator]
              │ 원문 접근
              ▼
 [Internal Connector + 사내 LLM]
  - 검색/RAG  - 비밀정보 필터  - 근거 ID 발급
              │ outbound-only, 허용된 요약/메타데이터만
              ▼
       [AI Office Control Plane]
  - 요청  - 에이전트 상태  - 결과  - 감사 로그
              │ 승인된 명령만
              ▼
      [Internal Git Issue Adapter]
```

회사 정책상 요약도 외부 전송할 수 없다면 웹 대시보드와 오케스트레이터까지 모두 사내에 배포하는 **완전 온프레미스 모드**를 사용합니다. 외부 AI는 제품 골격과 공개 가능한 프롬프트/계약만 개발하고, 실제 실행은 내부 LLM이 담당합니다.

자세한 내용은 [아키텍처](docs/ARCHITECTURE.md)와 [보안 경계](docs/SECURITY.md)를 참고하세요.

## 회사에서 Claude로 연동 시작하기

회사에서 `ai-office`와 실제 simulator 저장소를 같은 workspace에 열고 Claude에게
[사내 연동 인계서](docs/CLAUDE_COMPANY_INTEGRATION.md)를 먼저 읽게 하면 됩니다.

> 실제 simulator 저장소를 열기 전에 Claude/OpenCode가 회사 승인 사내 endpoint인지,
> 학습 미사용·보존 정책과 외부 egress 차단이 확인됐는지 먼저 검증해야 합니다.
> 개인용 또는 외부 Claude에는 이 AI Office 골격만 보여 주고 회사 저장소는 열지 마세요.

- 실제 `.LLM`, DLD, TopView, `common`, FTL, FIL, HIL 경로:
  [에이전트/경로 설정 예제](config/agents.example.yaml)
- 역할별 `CodeLLMPro` 등 OpenCode 모델 배정:
  [회사 OpenCode 설정 예제](config/opencode.company.example.json)
- 현재 POC는 단일 모델 호출입니다. 역할별 실제 호출과 UI 모델 선택은 인계서의
  최소 작업 순서대로 company runtime에 연결합니다.

## 로컬 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm install
npm run dev
```

브라우저에서 출력된 로컬 주소를 열면 됩니다.

### OpenCode Zen 무료 모델로 합성 POC 실행

8GB Mac에서 로컬 LLM을 띄우지 않고 OpenCode 1.4.3의 Zen 무료 모델을 원격 호출합니다. POC 기본 모델은 실호출 검증을 통과한 `opencode/deepseek-v4-flash-free`입니다. 로컬 bridge는 loopback에만 바인딩되고, 모바일 브라우저는 웹서버의 same-origin API만 호출합니다.

첫 실행 전 현재 무료 모델 카탈로그를 갱신합니다.

```bash
opencode models opencode
```

맥에서만 볼 때는 두 터미널에서 실행합니다.

```bash
# 터미널 1: 합성 데이터 전용 Zen bridge
npm run poc:bridge

# 터미널 2: 웹 사무실
npm run dev:poc -- -H 127.0.0.1
```

같은 tailnet의 모바일에서 볼 때는 `0.0.0.0`이 아닌 이 기기의 Tailscale IP에만 바인딩합니다.

```bash
npm run dev:poc -- -H "$(tailscale ip -4)"
```

모바일에서 `http://<맥의 Tailscale IP>:3000`을 엽니다. 웹서버를 직접 열어 두는 방식이므로 tailnet ACL에서 해당 모바일만 맥에 접근하도록 제한해야 합니다. bridge가 꺼지거나 Zen이 거절하면 로컬 UI는 안전하게 실패를 표시하고 호스팅 데모로 재전송하지 않습니다. 배포된 사이트는 계속 결정론적 합성 데모만 사용합니다.

현재 POC의 여섯 자리는 서로 다른 책임을 가진 **논리 에이전트**입니다. 요청 한 건을 OpenCode 프로세스 1개·모델 턴 1개로 처리하고, 한 번의 구조화 결과에 다섯 전문 역할과 오케스트레이터 결론을 담습니다. UI의 업무 전달 애니메이션은 이 논리적 단계를 보여 줍니다. 사내 전환 시 `AgentRuntime` 구현만 실제 다중 에이전트 fan-out으로 바꿀 수 있으며 UI와 결과 계약은 유지됩니다.

> Zen 무료 모델은 외부 서비스이며 요청이 미국에서 처리됩니다. 입력문 원문은 Zen으로 보내지 않고 서버 소유의 합성 시나리오로 치환하지만, 실제 회사 요청, 코드, Wiki, 성능 수치, 경로, 식별자를 입력하지 마세요. [OpenCode Zen 공식 문서](https://opencode.ai/docs/zen)에 따르면 무료 모델은 제공자의 모델 개선을 위해 데이터를 보관·사용할 수 있고 제공 기간도 한정적입니다.

OpenCode 1.4.3의 무인증 무료 Zen 경로는 글로벌 XDG config/data/cache를 참조해야 합니다. bridge는 `HOME`, state, 작업 디렉터리를 매번 격리하고 모델·버전·합성 정책을 고정하지만, 글로벌 OpenCode 인증/세션 상태가 완전히 격리되지는 않습니다. `poc:bridge:zen`은 이 제약을 `synthetic-only`로 명시적으로 수용한 로컬 POC에서만 실행합니다. 2026-08-21 전에 전용 계정/상태 격리 또는 사내 OpenCode runtime으로 교체합니다.

### 교체 지점

| 지금 POC | 사내 전환 시 교체 | UI 변경 |
|---|---|---|
| `OpenCodeCliRuntime` + Zen 무료 모델 | `OpenCodeCliRuntime` + 사내 LLM 모델 | 없음 |
| `SyntheticSimulatorSource` | 승인된 Wiki/Git/Simulator connector | 없음 |
| 결과 JSON schema | 같은 버전의 사내 artifact contract | 없음 |

OpenCode 경로는 런타임을 명시적으로 선택한 로컬 환경에서만 켭니다. 외부 호스팅 환경은 CLI를 실행하지 않고 합성 데모만 반환합니다.

## 실제 저장소를 붙이는 순서

1. 회사 보안팀과 데이터 등급 및 반출 가능 필드를 먼저 확정합니다.
2. 사내 VM 또는 Kubernetes에 read-only `internal connector`를 배포합니다.
3. Wiki, Git, 시뮬레이터별 어댑터를 연결하고 서비스 계정 권한을 최소화합니다.
4. 기능 요청 한 건으로 조사 산출물과 인용 근거가 재현되는지 shadow mode로 검증합니다.
5. Git 연동은 이슈 **초안 생성**까지만 자동화하고, 사람 승인 뒤 등록하도록 시작합니다.
6. 품질/보안 지표가 안정된 뒤에만 자동 등록 범위를 넓힙니다.

실제 연동을 시작할 때 필요한 정보는 다음과 같습니다.

- 사내 Git 제품과 인증 방식(GitHub Enterprise, GitLab, Bitbucket 등)
- LLM Wiki의 저장 형식과 검색 인터페이스
- 사내에서 허용되는 LLM 및 외부 통신 정책
- 배포 환경(VM, Docker, Kubernetes)과 SSO 방식
- 이슈 템플릿, 라벨, 승인자, 우선순위 산정 규칙

## 문서

- [Claude용 사내 연동 인계서](docs/CLAUDE_COMPANY_INTEGRATION.md)
- [시스템 아키텍처](docs/ARCHITECTURE.md)
- [보안 및 위협 모델](docs/SECURITY.md)
