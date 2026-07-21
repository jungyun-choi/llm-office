import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render(extraHeaders = {}) {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html", ...extraHeaders },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("uses a trusted public origin even when proxy headers are hostile", async () => {
  const response = await render({
    host: "evil.example:99999",
    "x-forwarded-host": "evil.example",
    "x-forwarded-proto": "http",
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.doesNotMatch(html, /evil\.example/i);
  assert.match(
    html,
    /https:\/\/ai-office-sim-prep\.chil9199\.chatgpt\.site\/og-ai-office\.png/i,
  );
});

test("server-renders the AI Office floor", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ko">/i);
  assert.match(html, /<title>AI Office \| 팀이 움직이는 디지털 사무실<\/title>/i);
  assert.match(html, /팀이 움직이는 사무실/);
  assert.match(html, /오비트에게 요청/);
  assert.match(html, /오케스트레이터/);
  assert.match(html, /자료조사/);
  assert.match(html, /프레임워크/);
  assert.match(html, /견적분석/);
  assert.match(html, /테스트/);
  assert.match(html, /결과 보관함/);
  assert.match(html, /id="main-content"/);
  assert.match(html, /본문으로 건너뛰기/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});

test("removes starter-only code and keeps interactive office wiring", async () => {
  const [
    page,
    layout,
    officeClient,
    officeFloor,
    officeData,
    workflow,
    composer,
    drawer,
    styles,
    packageJson,
  ] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/features/office/office-client.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/features/office/components/office-floor.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/features/office/office-data.ts", import.meta.url), "utf8",
    ),
    readFile(
      new URL("../app/features/office/hooks/use-office-workflow.ts", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/features/office/components/task-composer.tsx", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../app/features/office/components/result-drawer.tsx", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<OfficeClient \/>/);
  assert.doesNotMatch(page, /codex-preview|_sites-preview|SkeletonPreview/);
  assert.match(layout, /<html lang="ko">/);
  assert.match(layout, /OFFICE_COPY\.metadata/);
  assert.match(officeClient, /<OfficeFloor/);
  assert.match(officeClient, /<ResultDrawer/);
  assert.match(officeFloor, /handoff-caption__mobile-details/);
  assert.match(officeFloor, /activeWorkers\.map/);
  assert.match(officeFloor, /data-workflow-status/);
  assert.match(officeFloor, /className="sr-only" role="status" aria-live="polite"/);
  assert.doesNotMatch(officeFloor, /className="handoff-caption" aria-live=/);
  assert.match(workflow, /DEMO_WORKFLOW/);
  assert.match(workflow, /window\.clearTimeout/);
  assert.match(workflow, /slice\(0, MAX_RESULTS\)/);
  assert.match(workflow, /setIsResultArriving\(true\)/);
  assert.match(composer, /event\.metaKey \|\| event\.ctrlKey/);
  assert.match(drawer, /querySelectorAll<HTMLElement>/);
  assert.match(drawer, /activeElement === last/);
  assert.ok(
    officeData.indexOf('id: "orchestrator"') < officeData.indexOf('id: "research"'),
    "the orchestrator should be the first mobile office seat",
  );
  const reducedMotionDwell = officeData.match(
    /REDUCED_MOTION_STAGE_DURATION_MS\s*=\s*([\d_]+)/,
  );
  assert.ok(reducedMotionDwell, "reduced-motion dwell should be declared");
  assert.ok(
    Number(reducedMotionDwell[1].replaceAll("_", "")) >= 1_500,
    "reduced-motion stages must remain readable",
  );
  assert.match(styles, /\.handoff-caption__mobile-details/);
  assert.match(styles, /\.agent-stations\s*\{[\s\S]*?order:\s*4;/);
  assert.match(
    styles,
    /\.agent-station\[data-state="sending"\] \.agent-station__label small \{[\s\S]*?color: var\(--office-navy\);/,
  );
  assert.doesNotMatch(styles, /\[data-state="idle"\] \.agent-station__label,/);
  assert.match(packageJson, /"lucide-react"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(access(new URL("app/_sites-preview", projectRoot)));
});
