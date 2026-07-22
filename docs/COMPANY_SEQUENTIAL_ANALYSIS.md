# Company 5+1 순차 분석 연동

이 문서는 사내 branch의 `company` OpenCode 실행기를 AI Office의 영속 업무 큐에 연결하는
계약이다. 공개 저장소에는 회사 endpoint, 인증 staging, 자동 이슈 publisher가 없으므로
그 구현을 추측해 복제하지 않는다.

## 결론

별도 `RunStore`와 `/api/v1/poc/runs/:runId/status`를 만들지 않는다. AI Office는 이미
다음을 제공한다.

- `POST /api/v1/jobs`: 즉시 `202`와 Job DTO 반환
- SQLite FIFO, idempotency, 재시작 복구
- `GET /api/v1/jobs`: PC/모바일 공통 상태 polling
- job event/history와 Claude 승인 흐름

회사 분석기는 각 역할 전환을 progress callback으로 알려 주고, Job worker가 같은 Job의
`analysisStages`를 SQLite에 저장한다.

```text
research → framework → estimate → test → git → orchestrator
```

각 단계는 `pending → running → completed|failed`로 전이한다. 실패하면 이후 단계는 실행하지
않는다.

한 역할 호출이 오래 걸릴 때는 확인 가능한 내부 phase만 갱신한다.

```text
preparing_context → calling_model → validating_output
```

UI는 `startedAt`에서 계산한 경과 시간과 attempt를 보여 준다. 모델의 chain-of-thought나
근거 없는 완료 퍼센트는 저장하거나 표시하지 않는다.

## 공개 계약

```ts
type PocAnalysisStageId =
  | "research"
  | "framework"
  | "estimate"
  | "test"
  | "git"
  | "orchestrator";

interface AgentRuntimeProgress {
  role: PocAnalysisStageId;
  status: "pending" | "running" | "completed" | "failed";
  phase?: "preparing_context" | "calling_model" | "validating_output";
  attempt?: number;
  summary?: string;
}

interface AgentRuntimeRequest {
  featureRequest: string;
  source: SimulatorSourceContext;
  signal?: AbortSignal;
  onProgress?: (progress: AgentRuntimeProgress) => void | Promise<void>;
}
```

runtime은 한 번에 한 역할의 event를 보낸다. Job worker가 event를 `startedAt`, `updatedAt`,
`completedAt`이 포함된 전체 `analysisStages` snapshot으로 합쳐 SQLite에 저장한다. Job DTO는
그 snapshot을 그대로 노출하고, 프론트는 기존 polling 응답을 읽어 현재 역할 한 명만 작업
상태로, 이전 역할은 완료, 이후 역할은 대기로 표시한다.

## 사내 company runtime 구현

현재 공개 `OpenCodeProfile`은 `internal|zen`뿐이다. 사내 branch에서만 `company`를 추가하고
기존 Zen/internal process는 수정하지 않는다.

순서, 앞 단계 context 전달, 역할별 schema 검증, 실패 시 중단과 progress event 발생은 이미
`lib/poc/application/sequential-agent-runtime.ts`의 `runSequentialAgentRuntime()`에 있다.
사내 코드는 `SequentialTurnExecutor`로 회사 인증·격리된 OpenCode 호출 한 건을 구현하고,
`promptFor(role)`로 승인된 prompt package를 공급한다.

1. `company-opencode-process.ts`는 prompt 하나·model turn 하나만 실행한다.
2. 매 호출마다 새 `0700` runtime directory를 만들고 종료 시 정리한다.
3. `OPENCODE_CONFIG_CONTENT.tools`는 모두 `false`다.
4. 회사 인증 plugin 때문에 필요한 기본 plugin은 끄지 않는다.
5. `stageCompanyAuth`는 각 독립 호출마다 실행한다.
6. 호출당 timeout을 적용하고 전체 Job은 HTTP 연결과 무관하게 background worker에서 돈다.
7. secret, 원문, stack trace는 progress summary/event에 넣지 않는다.

역할별 실행:

| 순서 | 역할 | 출력 검증 | 입력 |
|---:|---|---|---|
| 1 | research | `roleOutputSchema`, role 일치 | 요청 + 최소 repository snapshot |
| 2 | framework | 동일 | + research |
| 3 | estimate | 동일 | + research/framework |
| 4 | test | 동일 | + 앞 3개 |
| 5 | git | 동일 | + 앞 4개 |
| 6 | orchestrator | `pocBriefSchema` | 검증된 5개 role output |

마지막에는 반드시 다음 전체 검증을 다시 수행한다.

```ts
pocModelOutputSchema.parse({ roleOutputs, brief });
```

자유서술 prior result는 `UNTRUSTED_DATA` 필드로 넣고 system prompt나 tool policy로 승격하지
않는다. 역할 prompt는 회사 branch의 승인된 prompt package/digest에서 읽는다.

## progress 호출 예시

```ts
await onProgress?.({
  role: "research", status: "running", phase: "preparing_context", attempt: 1,
});
try {
  await onProgress?.({
    role: "research", status: "running", phase: "calling_model", attempt: 1,
  });
  const research = roleOutputSchema.parse(await runRole("research", context));
  await onProgress?.({
    role: "research", status: "running", phase: "validating_output", attempt: 1,
  });
  await onProgress?.({
    role: "research", status: "completed", attempt: 1, summary: research.summary,
  });
} catch (error) {
  await onProgress?.({ role: "research", status: "failed", attempt: 1 });
  throw error;
}
```

Job worker는 callback마다 최신 DB version을 다시 읽고 전체 snapshot을 갱신한다. 사내
runtime은 callback을 `await`해 순서가 뒤집히지 않게 한다.

## 기존 경로와의 호환

- `zen`, `internal`, `codex`: 지금처럼 model turn 1회, progress callback 생략 가능
- legacy `/api/v1/poc/runs`: 동기 계약 유지
- Office canonical 경로: `/api/v1/jobs`만 사용
- 최종 `PocRunResult`와 role id: 변경 없음
- 실제 이슈 자동 등록: 공개 저장소에는 구현이 없으므로 사내 publisher에서 exact-once를
  별도로 검증한다. 공개 골격은 이슈 초안만 보존한다.

## 검증 항목

- 정상: 정확히 6회, 정해진 순서, 매번 새 runtime directory
- 컨텍스트: N단계에는 검증된 1..N-1 결과만 포함
- 실패: estimate 실패 시 research/framework만 completed, estimate failed, 나머지 pending
- 중단: cancel/timeout 뒤 다음 CLI 호출 없음
- 저장: bridge 재조회/브라우저 새로고침에도 stage snapshot 유지
- 보안: tools false, company auth staging 매 호출, 기본 인증 plugin 유지, secret DTO 미노출
- 회귀: zen/internal/codex의 기존 1 turn과 결과 schema 유지
- UI: 현재 역할 하나만 작업 중, summary/실패 역할/전체 `n/6` 표시
