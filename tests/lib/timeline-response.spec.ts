import { test, expect } from "@playwright/test";
import http from "node:http";
import { AddressInfo } from "node:net";
import { captureTimeline } from "./timeline-response";

const BODY = { success: true, data: [{ id: "1", kind: "1", title: "t", content: "<p>c</p>", open_datetime: "2026-11-13 09:00:00" }] };

// XHR を投げて完了を document.title に記録するページと、timeline API を返すだけのサーバー
function startServer(timelineStatus = 200, timelineBody: unknown = BODY) {
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/api/v2/parent/timeline/")) {
      res.writeHead(timelineStatus, { "content-type": "application/json" });
      res.end(JSON.stringify(timelineBody));
      return;
    }
    res.writeHead(200, { "content-type": "text/html" });
    res.end(
      req.url === "/other"
        ? "<!doctype html><title>other</title>"
        : `<!doctype html><title>loading</title><script>
             fetch("/api/v2/parent/timeline/?listpage=1").then(() => { document.title = "fetched"; });
           </script>`
    );
  });
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
  });
}

test("returns the timeline json even when the page navigates away afterwards", async ({ page }) => {
  const server = await startServer();
  try {
    const timeline = await captureTimeline(page, 15000);
    await page.goto(`${server.url}/home`);
    // レスポンス到着を待ってから遷移し、旧ドキュメントのボディを破棄させる
    await page.waitForFunction(() => document.title === "fetched");
    await page.goto(`${server.url}/other`);

    expect(await timeline.json()).toEqual(BODY);
  } finally {
    await server.close();
  }
});

test("throws with the status when the timeline request fails", async ({ page }) => {
  const server = await startServer(503, { success: false });
  try {
    const timeline = await captureTimeline(page, 15000);
    await page.goto(`${server.url}/home`);
    await expect(timeline.json()).rejects.toThrow("Timeline fetch failed: 503");
  } finally {
    await server.close();
  }
});

test("throws when the payload is not a timeline response", async ({ page }) => {
  const server = await startServer(200, { success: false, data: [] });
  try {
    const timeline = await captureTimeline(page, 15000);
    await page.goto(`${server.url}/home`);
    await expect(timeline.json()).rejects.toThrow("Unexpected timeline response");
  } finally {
    await server.close();
  }
});
