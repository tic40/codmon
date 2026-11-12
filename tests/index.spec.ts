import { test, expect, Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { TimelineItem, toPosts, parseSeen, serializeSeen, planNotification, formatMessage } from "./lib/timeline";

const {
  CODMON_LOGIN_URL = "https://parents.codmon.com",
  CODMON_EMAIL = "",
  CODMON_PW = "",
  SLACK_WEBHOOK_URL = "",
} = process.env;

const SEEN_POSTS_PATH = path.resolve(__dirname, "../data/seen-posts.json");

function loadSeen(): Set<string> | null {
  try {
    return parseSeen(JSON.parse(fs.readFileSync(SEEN_POSTS_PATH, "utf-8")));
  } catch {
    return null;
  }
}

function saveSeen(ids: Set<string>) {
  fs.mkdirSync(path.dirname(SEEN_POSTS_PATH), { recursive: true });
  fs.writeFileSync(SEEN_POSTS_PATH, serializeSeen(ids));
}

async function login(page: Page) {
  await page.goto(CODMON_LOGIN_URL, { waitUntil: "networkidle" });

  const alreadyHasAccount = page.getByText("すでにアカウントをお持ちの方");
  if (await alreadyHasAccount.isVisible({ timeout: 3000 }).catch(() => false)) {
    await alreadyHasAccount.click();
    await page.waitForLoadState("networkidle");
  }

  await page.getByPlaceholder("メールアドレス").fill(CODMON_EMAIL);
  await page.getByPlaceholder("パスワード").fill(CODMON_PW);

  // ログイン前から /home にリダイレクトされるため URL ではなくログイン API の完了を待つ
  const loginRes = page.waitForResponse(
    (r) => r.url().includes("/api/v2/parent/login") && r.request().method() === "POST",
    { timeout: 30000 }
  );
  await page.getByText("ログインする").click();
  const res = await loginRes;
  if (!res.ok()) throw new Error(`Login failed: ${res.status()}`);
  await page.getByPlaceholder("パスワード").waitFor({ state: "detached", timeout: 30000 });
}

async function sendToSlack(text: string) {
  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, channel: "#保育園" }),
  });
  if (!res.ok) {
    throw new Error(`Slack post failed: ${res.status}`);
  }
}

function getCurrentDate(): string {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const y = jst.getUTCFullYear();
  const m = String(jst.getUTCMonth() + 1).padStart(2, "0");
  const d = String(jst.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

test("get contact comment", async ({ page }) => {
  await login(page);

  await page.goto("https://parents.codmon.com/contact", {
    waitUntil: "networkidle",
  });

  // 未ログイン等で連絡帳画面が描画されていない場合に「未記入」と誤通知しないよう失敗させる
  await page.locator(".notebook_tab").first().waitFor({ state: "visible", timeout: 15000 });

  await page.screenshot({
    path: "test-results/contact-page.png",
    fullPage: true,
  });

  const commentText = await page.evaluate(() => {
    const label = document.querySelector(
      "p.notebookPreview_item.notebookPreview_item-other"
    );
    if (!label) return null;
    const col = label.closest("ons-col");
    if (!col) return null;
    return col.nextElementSibling?.textContent?.trim() ?? null;
  });

  const date = getCurrentDate();
  const message = commentText
    ? `📝 ${date} 連絡帳コメント\n\`\`\`${commentText}\`\`\``
    : `⚠️ ${date} 連絡帳が未記入です`;

  console.log(message);

  if (SLACK_WEBHOOK_URL) {
    await sendToSlack(message);
  }
});

test("fetch unread home posts", async ({ page }) => {
  await login(page);

  const timelineRes = page.waitForResponse(
    (r) => r.url().includes("/api/v2/parent/timeline/") && r.request().method() === "GET",
    { timeout: 30000 }
  );
  await page.goto("https://parents.codmon.com/home", { waitUntil: "networkidle" });
  const res = await timelineRes;
  if (!res.ok()) throw new Error(`Timeline fetch failed: ${res.status()}`);
  const json = (await res.json()) as { success: boolean; data: TimelineItem[] };
  if (!json.success || !Array.isArray(json.data)) throw new Error("Unexpected timeline response");

  const seen = loadSeen();
  const posts = toPosts(json.data);
  const plan = planNotification(posts, seen);
  console.log(`記事数: ${json.data.length}, 対象: ${posts.length}, 未読: ${plan.toNotify.length}${seen ? "" : " (既読情報なしのため初期化)"}`);

  if (plan.toNotify.length === 0) {
    console.log("新しいお知らせはありません");
  } else {
    const message = formatMessage(plan.toNotify);
    console.log(message);
    if (SLACK_WEBHOOK_URL) {
      await sendToSlack(message);
    }
  }

  saveSeen(plan.seen);
  expect(plan.seen.size).toBeGreaterThan(0);
});
