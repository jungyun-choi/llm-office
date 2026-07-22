# Dual Office 실행 흐름

AI Office는 한 대의 서버에서 두 개의 권한 영역을 순차 실행한다.

```text
요청
  → OpenCode 분석실 (읽기 전용)
  → 분석 패킷 검토 및 사용자 승인
  → Claude 개발실 (업무 전용 Git worktree 쓰기)
  → 서버가 허용된 테스트 실행
  → Diff 검토 및 사용자 승인
  → 업무 브랜치 Commit, 선택적으로 Push + PR 생성
  → PR 최종 코드 검토 게이트
     ├─ 리뷰 피드백과 함께 Claude 재개발 → 같은 PR에 후속 Push
     └─ 최종 머지 승인 → 완료
```

분석이 끝났다고 Claude가 자동으로 코딩하지 않으며, 테스트가 통과했다고 Git에 자동으로
반영하지도 않는다. Push 이후에도 자동 머지하지 않으며, 구현 시작·Git 반영·PR 머지는
각각 별도의 사용자 승인을 요구한다.

## 단일 서버 구성

```text
브라우저
  │ same-origin /api/v1/jobs
  ▼
Vinext 웹 프로세스
  │ bridge token은 서버 내부에서만 전달
  ▼
127.0.0.1:4317 Node bridge
  ├─ SQLite FIFO와 상태 히스토리
  ├─ OpenCode 분석 runtime
  ├─ Claude Code coding runtime
  ├─ Git worktree adapter
  └─ allowlist 테스트 및 Git publisher
```

브리지 포트는 외부에 열지 않는다. 웹은 개인 tailnet에서 소유자 단말만 허용하거나,
회사 SSO/MFA가 적용된 reverse proxy 뒤에서만 노출한다.

## 상태와 승인

업무는 다음 상태만 사용한다.

```text
queued → analyzing → awaiting_coding_approval
  → coding_queued → coding → testing → changes_ready
  → publishing → review_pending
       ├─ request_changes → coding_queued
       └─ merge_pr → merging → completed
```

실패와 취소는 각각 `failed`, `canceled`다. 서버 재시작 시 실행 중이던 업무는 안전한
복구 상태로 전환하고, 대기 업무는 SQLite에서 다시 읽어 FIFO 순서를 이어간다.

- 코딩 승인에는 job의 최신 `version`과 분석 패킷 `digest`가 필요하다.
- Git 승인에는 최신 `version`과 변경 묶음 `digest`가 필요하다.
- 화면을 오래 열어 둔 상태에서 산출물이 바뀌면 승인을 `409`로 거절한다.
- `commit_and_push`는 `AI_OFFICE_GIT_PUSH_ENABLED=1`일 때만 허용한다.
- `review_pending`에서는 PR 링크로 GitHub 구현·clinko 코멘트를 확인한 뒤에만 재의뢰 또는 머지한다.
- 재의뢰 피드백은 1~4,000자이며 동일 PR 브랜치의 다음 Claude 실행 컨텍스트에 포함된다.
- PR 머지에는 최신 변경 `digest`가 다시 필요하다.

## Claude 실행 경계

Claude는 main 작업 디렉터리를 직접 수정하지 않는다. 서버가 분석 시점의 base SHA에서
`ai-office/<job-id>` 업무 브랜치와 별도 worktree를 만든 뒤 그 디렉터리에서만 실행한다.

- Claude 도구: `Read`, `Edit`, `Write`, `Glob`, `Grep`
- Claude에 허용하지 않는 것: 임의 shell, Git 명령, 네트워크 도구, Push/merge
- 테스트: 모델이 만든 문자열이 아니라 서버의 고정 command allowlist만 실행
- 변경 검사: 모든 수정 파일이 `AI_OFFICE_CODING_ALLOWED_PATHS` 안에 있어야 함
- Git 반영: Claude가 아니라 deterministic publisher가 승인된 digest만 Commit/Push
- 화면에 노출하지 않는 것: worktree 절대 경로, credential, bridge token

외부 Claude를 사용하는 `synthetic` profile은 서버가 정한 합성 요청과 합성 저장소만
전송한다. 브라우저에 입력한 원문은 Claude prompt에 포함하지 않는다. 실제 회사 저장소는
반드시 `internal` profile과 회사가 승인한 endpoint에서만 사용한다.

## API

```text
GET  /api/v1/jobs/capabilities
POST /api/v1/jobs
GET  /api/v1/jobs?limit=30&offset=0
GET  /api/v1/jobs/{jobId}
POST /api/v1/jobs/{jobId}/actions
```

새 업무 요청에는 `Idempotency-Key`를 사용한다. 승인 액션은 다음과 같다.

```text
approve_coding
publish_changes  mode=commit|commit_and_push
request_changes  feedback=<1~4000자>
merge_pr         artifactDigest=<latest changes digest>
cancel
retry
```

## 사내 교체 지점

POC에서 실제 회사 시스템으로 옮길 때 UI나 상태 모델을 다시 만들지 않는다.

| POC | 사내 교체 |
|---|---|
| OpenCode Zen + 합성 snapshot | 회사 OpenCode + `.LLM`/DLD/TopView/code connector |
| Claude Code synthetic profile | 회사 승인 Claude Code 또는 `CodingRuntime` adapter |
| `poc/simulator` 경로 allowlist | 실제 simulator repository와 승인된 path 목록 |
| Python 합성 테스트 1개 | 회사 test command ID allowlist |
| 개인 tailnet | SSO/MFA reverse proxy와 사용자/project 권한 |

처음 사내 연결에서는 `commit`까지만 허용한다. Push를 켜기 전에 branch protection,
서비스 계정 최소 권한, 감사 로그와 승인자 정책을 먼저 확인한다.
