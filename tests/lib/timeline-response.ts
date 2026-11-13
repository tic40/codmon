import type { Page } from "@playwright/test";
import type { TimelineItem } from "./timeline";

export type TimelineResponse = { success: boolean; data: TimelineItem[] };

const TIMELINE_URL = "**/api/v2/parent/timeline/**";

export type TimelineCapture = { json(): Promise<TimelineResponse> };

function parse(body: string): TimelineResponse {
  const json = JSON.parse(body) as TimelineResponse;
  if (!json.success || !Array.isArray(json.data)) throw new Error("Unexpected timeline response");
  return json;
}

// ページ遷移が起きるとブラウザは前のドキュメントのレスポンスボディを破棄するため、
// response を後から読むと getResponseBody が失敗する。ここで body を受け取り Node 側に保持する。
export async function captureTimeline(page: Page, timeout = 30000): Promise<TimelineCapture> {
  let settle!: (json: TimelineResponse) => void;
  let fail!: (err: Error) => void;
  const result = new Promise<TimelineResponse>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });

  const timer = setTimeout(
    () => fail(new Error(`Timeline response did not arrive within ${timeout}ms`)),
    timeout
  );
  result.then(
    () => clearTimeout(timer),
    () => clearTimeout(timer)
  );

  let captured = false;
  await page.route(TIMELINE_URL, async (route) => {
    if (captured || route.request().method() !== "GET") return route.fallback();
    captured = true;
    try {
      const response = await route.fetch();
      const body = await response.text();
      if (!response.ok()) throw new Error(`Timeline fetch failed: ${response.status()}`);
      settle(parse(body));
      await route.fulfill({ response, body }).catch(() => {});
    } catch (err) {
      fail(err as Error);
      await route.abort().catch(() => {});
    }
  });

  return { json: () => result };
}
