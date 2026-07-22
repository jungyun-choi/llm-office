import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOrbitIntakeBrief,
  createOrbitQuestions,
  parseOrbitQuestionSet,
} from "./orbit-intake";

test("Orbit accepts bounded company LLM questions", () => {
  const result = parseOrbitQuestionSet({
    source: "company-opencode",
    model: "codemate/CodeLLMPro",
    questions: [{
      id: "acceptance",
      prompt: "2MB 경계에서 반드시 보존해야 할 기존 동작은 무엇인가요?",
      hint: "회귀 기준을 확정합니다.",
      placeholder: "예: 기존 1MB 요청 결과는 동일해야 합니다.",
    }],
  });

  assert.equal(result.source, "company-opencode");
  assert.equal(result.questions[0]?.id, "acceptance");
});

test("Orbit rejects duplicate LLM question categories", () => {
  assert.throws(() => parseOrbitQuestionSet({
    source: "company-opencode",
    model: "codemate/CodeLLMPro",
    questions: [
      {
        id: "context",
        prompt: "관련 경로는 어디인가요?",
        hint: "범위를 좁힙니다.",
        placeholder: "예: FTL/read",
      },
      {
        id: "context",
        prompt: "관련 문서는 무엇인가요?",
        hint: "근거를 찾습니다.",
        placeholder: "예: .LLM DLD",
      },
    ],
  }));
});

test("Orbit asks only missing high-impact questions", () => {
  const vague = createOrbitQuestions("리드 버퍼를 더 크게 만들어 주세요");
  assert.deepEqual(vague.map(({ id }) => id), ["context", "acceptance"]);

  const detailed = createOrbitQuestions(
    "FTL read buffer를 1MB에서 2MB로 늘리고 DLD와 TopView를 확인해 경계 회귀 테스트까지 통과해 주세요",
  );
  assert.deepEqual(detailed.map(({ id }) => id), ["priority"]);
});

test("Orbit compacts answers into one shared implementation brief", () => {
  const brief = buildOrbitIntakeBrief("  Read buffer를   2MB로 늘려 주세요  ", {
    behavior: "현재 1MB 제한이며 2MB까지 정상 처리",
    context: "FTL/read_buffer와 .LLM DLD, TopView read scenario",
    acceptance: "1MB 회귀 없이 2MB 경계와 overflow 테스트 통과",
  });

  assert.equal(brief.objective, "Read buffer를 2MB로 늘려 주세요");
  assert.equal(brief.currentAndExpectedBehavior, "현재 1MB 제한이며 2MB까지 정상 처리");
  assert.match(brief.repositoryContext ?? "", /TopView/u);
  assert.match(brief.acceptanceAndTests ?? "", /overflow/u);
  assert.deepEqual(brief.assumptions, []);
});

test("quick handoff records concise assumptions instead of inventing details", () => {
  const brief = buildOrbitIntakeBrief("새로운 큐 정책을 도입해 주세요");

  assert.equal(brief.assumptions.length, 2);
  assert.match(brief.assumptions.join(" "), /DLD·TopView/u);
  assert.match(brief.assumptions.join(" "), /테스트/u);
});
