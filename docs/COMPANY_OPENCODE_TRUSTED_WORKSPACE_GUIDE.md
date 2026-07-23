# 사내 OpenCode 신뢰 워크스페이스 전환 가이드

> 대상: 사내 격리 서버에서 `AI_OFFICE_OPENCODE_PROFILE=company`로 실행하는 분석팀
>
> 결론: `company` 프로파일은 합성 POC가 아니다. 사내 OpenCode가 실제 Louvre 저장소를
> 직접 탐색하도록 해야 한다. Zen/외부 모델용 제한을 `company`에 재사용하지 않는다.

이 문서는 현재 `company` 분석 실행기의 과도한 제한을 제거하기 위한 클로드 작업 지시서다.
기존 문서의 `company에서도 모든 tool/permission을 끈다`, `첨부된 snapshot만 사용한다`는
지시는 이 문서로 대체한다.

## 1. 지금 OpenCode가 깊게 분석하지 못하는 이유

현재 구현은 다음 제한을 동시에 적용한다.

1. `company-turn-executor.ts`의 `companyInlineConfig()`가
   `permission: { "*": "deny" }`와 모든 tool `false`를 주입한다.
2. 같은 파일이 OpenCode의 `--dir`을 실제 Louvre 저장소가 아니라 매 턴 새로 만든 빈
   `runtime.workspace`로 지정한다.
3. `OPENCODE_DISABLE_PROJECT_CONFIG=1` 때문에 Louvre 저장소의 `AGENTS.md`, OpenCode 설정,
   사내 프로젝트 지침을 읽지 못한다.
4. `sequential-agent-runtime.ts`와 `poc/company-prompts/*.md`가 모델에
   `Do not call tools`, `Use only attached context`를 반복해서 지시한다.
5. 실제 저장소 대신 source extension이 미리 만든 최대 16MiB 문자열 snapshot만 전달한다.
6. 모델이 실제 절대 경로나 stack trace를 한 번이라도 출력하면
   `company-output-boundary.ts`가 전체 결과를 `invalid_output`으로 폐기한다.

결과적으로 OpenCode는 사내 에이전트인데도 다음을 직접 할 수 없다.

- `.LLM` 아래 DLD, 설계 문서, 컨벤션, 디버깅 이력 검색
- 실제 디렉터리 구조 탐색
- `common`, HIL, FTL, FIL 소스와 SystemC symbol 추적
- TopView command scenario 및 packet-flow 자료 검색
- `git log`, `git blame`, 과거 변경과 테스트 구조 조사

이 상태에서 역할을 여섯 번 호출해도 같은 작은 snapshot을 여섯 번 요약할 뿐이다.

## 2. 목표 동작

`company` 프로파일의 각 분석 역할은 다음처럼 실행한다.

```text
AI Office Job
  -> 역할별 OpenCode 프로세스
  -> cwd = 실제 Louvre 저장소 root
  -> 사내 OpenCode의 repository read/search 도구 사용
  -> .LLM + DLD + TopView + source + test + Git history 직접 조사
  -> repository-relative 근거가 포함된 기존 JSON schema 반환
```

역할 순서와 UI 진행 상태는 그대로 유지한다.

```text
research -> framework -> estimate -> test -> git -> orchestrator
```

`company` 분석팀은 코드를 구현하지 않는다. 다만 **저장소를 읽고 검색하고 Git 이력을
조사하는 권한은 정상적으로 사용**해야 한다. 코딩과 Push 승인은 개발팀과 Human Gate에서
별도로 처리한다.

## 3. 프로파일별 권한 원칙

| 프로파일 | 데이터 | 워크스페이스 | 도구 정책 |
|---|---|---|---|
| `zen` | 합성 데이터만 | 임시 합성 폴더 | 현재 제한 유지 |
| `internal` | 로컬 POC | 현재 동작 유지 | 현재 제한 유지 |
| `company` | 사내 Louvre 저장소 | 실제 저장소 root | 사내 OpenCode 기본 도구 사용 |

핵심은 단순하다. `company`라는 값 자체가 이미 “회사 격리 환경의 사내 모델과 사내
에이전트”를 뜻한다. 이 경로에 외부 모델용 sandbox를 한 번 더 흉내 내지 않는다.

## 4. 필수 변경 사항

### 4.1 실제 저장소에서 실행

대상:

- `lib/poc/infrastructure/company-turn-executor.ts`
- `lib/poc/application/sequential-agent-runtime.ts`
- 필요하면 `lib/poc/application/ports/agent-runtime.ts`

변경:

- `CompanyTurnExecutor.execute()`가 `request.source.workingDirectory` 또는 명시적으로 전달된
  Louvre root를 받게 한다.
- `opencode run --dir`과 child process `cwd`를 모두 그 실제 root로 지정한다.
- 실제 root는 이미 검증된 `SimulatorSourceContext.workingDirectory`를 사용한다.
- 매 턴 만드는 임시 폴더는 auth/context 임시 파일 용도로만 사용한다. 분석 cwd로 사용하지
  않는다.

완료 조건:

```text
OpenCode process cwd == realpath(AI_OFFICE_NIKE_ROOT)
OpenCode --dir        == realpath(AI_OFFICE_NIKE_ROOT)
```

### 4.2 도구와 프로젝트 설정을 강제로 끄지 않기

대상: `lib/poc/infrastructure/company-turn-executor.ts`

`companyInlineConfig()`에서 다음 주입을 제거한다.

```ts
permission: { "*": "deny" }
tools: { bash: false, read: false, grep: false, ... }
```

`companyEnvironment()`에서 다음도 제거한다.

```text
OPENCODE_DISABLE_PROJECT_CONFIG=1
```

사내 OpenCode 설치가 이미 가진 기본 plugin, project config, `AGENTS.md`, 사내 agent 구성을
사용하게 한다. AI Office가 별도 inline config를 계속 넣어야 한다면 다음 정도만 유지한다.

```json
{
  "share": "disabled",
  "autoupdate": false,
  "snapshot": false,
  "enabled_providers": ["codemate"]
}
```

도구 목록과 permission은 AI Office가 덮어쓰지 않는다. 회사 OpenCode 정책을 그대로 따른다.

필요한 분석 능력은 최소 다음과 같다.

- 파일/디렉터리 읽기와 검색
- symbol/code search 및 LSP
- repository 안의 `AGENTS.md`와 `.LLM` 문서 읽기
- read-only Git 이력 조사
- 사내 OpenCode가 제공하는 sub-agent/task 기능

`git commit`, `push`, 외부 이슈 등록은 분석 역할의 책임이 아니다. 하지만 이를 막겠다고
모든 도구를 꺼서 저장소 조사까지 막으면 안 된다.

### 4.3 프롬프트에서 도구 금지 문구 제거

대상:

- `lib/poc/application/sequential-agent-runtime.ts`
- `lib/office-jobs/infrastructure/company-orbit-question-generator.ts`
- `poc/company-prompts/research.md`
- `poc/company-prompts/framework.md`
- `poc/company-prompts/estimate.md`
- `poc/company-prompts/test.md`
- `poc/company-prompts/git.md`
- `poc/company-prompts/orchestrator.md`
- `poc/company-prompts/orbit.md`

다음 표현을 제거한다.

```text
Do not call tools.
Never call tools.
Use only the attached context.
Never access files.
```

역할 프롬프트는 다음 방향으로 바꾼다.

```text
You are running inside the approved internal Louvre repository.
Inspect the repository directly and use the internal OpenCode tools needed for evidence.
Read .LLM/DLD/project conventions, source, tests, TopView material, and Git history as relevant.
Do not implement or modify production code in the analysis stage.
Return concise JSON matching the required schema.
Every concrete claim must include a repository-relative file/symbol reference.
```

역할별 추가 지시:

- `research`: `.LLM`, DLD, 설계 문서, 컨벤션, 디버깅 이력을 직접 검색한다.
- `framework`: 실제 디렉터리 구조를 먼저 찾고 `common`, HIL, FTL, FIL과 SystemC 호출 흐름을
  symbol 단위로 추적한다. 경로를 미리 가정하지 않는다.
- `estimate`: TopView command scenario와 packet-flow 자료를 찾아 계층별 영향과 작업량을
  산정한다.
- `test`: 현재 test harness, 기존 회귀 테스트, trace/golden 결과를 찾아 실행 가능한 테스트
  계획을 만든다.
- `git`: 기존 issue/PR template과 Git history를 조사해 Claude용 인계 문서를 만든다. 실제
  issue 등록은 publisher가 담당한다.
- `orchestrator`: 다섯 역할의 근거를 압축하되 새로운 사실을 만들어내지 않는다.

### 4.4 snapshot을 참고자료로만 취급

대상:

- `lib/poc/infrastructure/extension-source-loader.ts`
- 사내 `ai-office-company-source-v1` extension
- `lib/poc/application/sequential-agent-runtime.ts`

source extension이 만드는 snapshot은 실행 가능 여부와 저장소 메타데이터를 전달하는 작은
seed로만 사용한다. OpenCode가 조사할 수 있는 정보의 상한으로 사용하지 않는다.

권장 context:

```ts
{
  sourceId,
  sourceDigest,
  repositoryRoot,
  featureRequest,
  priorResults
}
```

수백 개 파일 내용을 한 문자열로 미리 합치는 로직은 제거하거나 최소화한다. 실제 파일 선택은
각 전문 에이전트가 도구로 수행해야 한다. 그래야 역할마다 필요한 문서와 코드를 다르게 깊게
조사할 수 있다.

### 4.5 정상적인 내부 경로 때문에 결과 전체를 버리지 않기

대상: `lib/poc/infrastructure/company-output-boundary.ts`

다음 정책으로 바꾼다.

- 실제 credential/secret 패턴 검사는 유지한다.
- Louvre root 내부 절대 경로는 repository-relative path로 변환한다.
- root 밖 절대 경로는 결과에서 해당 문자열만 `[redacted-path]`로 치환한다.
- 절대 경로나 stack trace 한 건 때문에 전체 역할 결과를 `invalid_output`으로 폐기하지 않는다.
- UI와 coding packet에는 repository-relative 근거만 저장한다.

분석 에이전트가 실제 파일을 읽으면 절대 경로가 출력에 섞이는 일은 정상적이다. 이것을 모델
오류로 취급하면 깊은 조사를 허용한 뒤 결과를 마지막 단계에서 다시 버리는 셈이다.

### 4.6 OpenCode의 정상 회사 상태를 재사용

현재 매 턴 빈 `HOME/XDG_*`를 만들고 auth 파일 하나만 복사한다. 이 방식 때문에 회사에서
설치한 plugin, agent, skill, provider 설정이 사라진다면 다음 중 하나로 단순화한다.

권장 순서:

1. 사내 서버 전용 service account의 기존 OpenCode `HOME/XDG_*`를 그대로 사용한다.
2. 회사 정책상 분리가 필요하면 회사 OpenCode state directory를 환경 변수로 명시하고 모든
   역할이 그 디렉터리를 읽게 한다.
3. 임시 HOME을 유지해야만 한다면 auth뿐 아니라 회사 실행에 필요한 승인된 config/plugin
   state를 정확히 stage한다.

AI Office가 회사 OpenCode의 인증과 설정 체계를 새로 재현하려고 하지 않는다. 이미 회사에서
동작하는 `opencode run ...` 환경을 서버 프로세스에서도 그대로 사용하게 만드는 것이 목표다.

## 5. 유지할 경계

이번 변경은 보안을 전부 삭제하는 작업이 아니다. 사내 분석을 방해하는 중복 제한만 제거한다.

유지:

- `company`에서 Zen/Codex/외부 모델로 fallback 금지
- provider/model은 사내 `codemate/*` 사용
- 기존 역할별 JSON schema 검증
- 역할 진행 상태와 실패 상태 기록
- 사람 승인 전 코딩 시작 금지
- 사람 승인 전 Commit/Push/PR 금지
- 실제 secret이 UI, SQLite, log에 저장되지 않도록 redaction
- `zen` 합성 POC의 기존 제한

제거:

- company의 모든 tool/permission 강제 차단
- 실제 저장소 대신 빈 temp workspace에서 실행
- project config와 `AGENTS.md` 차단
- “첨부 snapshot만 사용” 프롬프트
- 정상적인 내부 path 하나로 전체 결과 폐기
- OpenCode가 이미 제공하는 사내 agent/plugin 설정 무시

## 6. 구현 순서

1. `company` process의 cwd/`--dir`을 Louvre root로 바꾼다.
2. `permission deny`, tools false, project-config disable을 제거한다.
3. company prompt의 tool 금지 문구를 역할별 repository 조사 지시로 교체한다.
4. snapshot을 seed로 축소하고 직접 repository 탐색을 기본으로 바꾼다.
5. output path를 거부가 아니라 상대 경로 변환/redaction으로 처리한다.
6. 실제 회사 OpenCode 한 역할을 먼저 실행해 도구 사용과 근거 품질을 확인한다.
7. 이후 5+1 전체 순차 실행과 UI polling을 검증한다.

처음부터 여섯 역할을 모두 돌리지 않는다. `research` 한 턴으로 아래 검증을 통과한 뒤 전체
pipeline을 실행한다. 실패 원인을 찾는 데 모델 호출 여섯 번을 낭비하지 않기 위함이다.

## 7. 필수 검증

### 7.1 회사 OpenCode 단독 기준선

AI Office 밖에서 회사 서버의 평소 환경으로 먼저 확인한다.

```bash
cd "$AI_OFFICE_NIKE_ROOT"
"$AI_OFFICE_OPENCODE_BIN" run \
  "현재 저장소의 .LLM 문서와 read path를 찾아 관련 파일 5개를 상대 경로로 반환해" \
  --model "$AI_OFFICE_MODEL_RESEARCH" \
  --dir "$AI_OFFICE_NIKE_ROOT"
```

이 명령에서 회사 OpenCode가 파일을 찾는데 AI Office 경로에서 못 찾으면 AI Office의 env/config
주입이 원인이다.

### 7.2 research 한 턴

다음 요청으로 `research`만 실행할 수 있는 개발용 entry 또는 테스트를 만든다.

```text
Read buffer 용량 파라미터 변경과 관련된 DLD, 기존 코드, 디버깅 이력을 조사해 줘.
```

통과 조건:

- `.LLM` 또는 실제 DLD 자료 근거가 최소 1개 있다.
- 실제 source/test 근거가 최소 2개 있다.
- 모든 근거 경로가 현재 Louvre root에서 존재한다.
- 요약만 반복하지 않고 symbol, parameter, call path 중 하나를 찾는다.
- OpenCode process가 실제 Louvre root에서 실행됐다는 debug log가 있다.
- 결과가 기존 `roleOutputSchema`를 통과한다.

### 7.3 5+1 전체 실행

통과 조건:

- 역할이 `research -> framework -> estimate -> test -> git -> orchestrator` 순서로 실행된다.
- 각 역할이 서로 다른 실제 근거를 추가한다.
- UI에 현재 역할과 phase가 보인다.
- 최종 brief에 수정 후보 파일/symbol, 구현 순서, 테스트, 위험, 제외 범위가 있다.
- Claude가 coding packet만 보고 저장소 재조사 시간을 줄일 수 있다.

### 7.4 회귀 확인

- `zen` 프로파일은 실제 Louvre 저장소를 읽지 못한다.
- `company` 실패가 외부 모델 fallback으로 이어지지 않는다.
- credential 문자열은 결과와 log에 남지 않는다.
- 분석 단계는 production source를 수정하지 않는다.
- Human Gate와 개발팀의 Commit/Push 통제는 그대로 동작한다.

## 8. 완료 보고에 반드시 포함할 것

클로드는 작업 후 다음을 짧게 보고한다.

1. 제거한 제한과 유지한 제한
2. 실제 OpenCode child process의 cwd와 `--dir`
3. research 한 턴에서 실제로 읽은 `.LLM`, source, test 근거 예시
4. 5+1 실행 시간과 역할별 성공/실패
5. 기존 test 결과
6. 아직 회사 OpenCode 설정에 의존하는 항목

“권한을 풀었으니 될 것”이라는 보고는 완료가 아니다. 실제 Louvre 파일을 OpenCode가 찾아서
근거로 반환한 로그와 결과가 있어야 완료다.

## 9. 클로드에게 그대로 전달할 짧은 지시문

```text
docs/COMPANY_OPENCODE_TRUSTED_WORKSPACE_GUIDE.md를 기준으로 수정해.

company는 외부 POC가 아니라 이미 격리된 사내 OpenCode 환경이다. 현재 AI Office가
permission deny, 모든 tools false, 빈 temp workspace, project config 비활성화,
"Do not call tools / attached context only" 프롬프트를 겹쳐 적용해 분석 에이전트를
사실상 장님으로 만들었다.

company만 실제 AI_OFFICE_NIKE_ROOT를 cwd와 --dir로 사용하고, 사내 OpenCode의 기본
도구/agent/plugin/project config를 그대로 사용하게 바꿔. 각 역할이 .LLM, DLD,
TopView, common/HIL/FTL/FIL, tests, Git history를 직접 조사해야 한다. zen 제한과
Human Gate/Commit/Push 통제는 유지해.

먼저 research 한 턴에서 실제 Louvre 파일 근거를 확인한 뒤 5+1 전체를 돌려.
코드 수정만 하고 끝내지 말고 가이드의 필수 검증 결과까지 보고해.
```
