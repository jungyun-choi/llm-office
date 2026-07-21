import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
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

test("server-renders the AI Office operations dashboard", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<html lang="ko">/i);
  assert.match(html, /<title>AI Office \| 시뮬레이션 개발 준비실<\/title>/i);
  assert.match(html, /시뮬레이션 개발 준비실/);
  assert.match(html, /에이전트 스테이션/);
  assert.match(html, /우선순위 업무 큐/);
  assert.match(html, /준비 파이프라인/);
  assert.match(html, /승인 대기/);
  assert.match(html, /신규 업무/);
  assert.match(html, /id="main-content"/);
  assert.match(html, /본문으로 건너뛰기/);
  assert.doesNotMatch(html, /codex-preview|Building your site|react-loading-skeleton/i);
});

test("removes starter-only code and keeps interactive dashboard wiring", async () => {
  const [page, layout, dashboard, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(
      new URL(
        "../app/features/operations-dashboard/dashboard-client.tsx",
        import.meta.url,
      ),
      "utf8",
    ),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(page, /<DashboardClient \/>/);
  assert.doesNotMatch(page, /codex-preview|_sites-preview|SkeletonPreview/);
  assert.match(layout, /<html lang="ko">/);
  assert.match(layout, /AI Office \| 시뮬레이션 개발 준비실/);
  assert.match(dashboard, /filterTasks/);
  assert.match(dashboard, /NewTaskModal/);
  assert.match(dashboard, /metaKey \|\| event\.ctrlKey/);
  assert.match(packageJson, /"lucide-react"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);

  await assert.rejects(access(new URL("app/_sites-preview", projectRoot)));
});

