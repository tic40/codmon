import { test, expect, Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const {
  CODMON_LOGIN_URL = "https://parents.codmon.com",
  CODMON_EMAIL = "",
  CODMON_PW = "",
  SLACK_WEBHOOK_URL = "",
} = process.env;

const SEEN_POSTS_PATH = path.resolve(__dirname, "../data/seen-posts.json");

type Post = {
  title: string;
  body: string;
  date: string;
  type: string;
};

function loadSeenIds(): Set<string> {
  try {
    const data = JSON.parse(fs.readFileSync(SEEN_POSTS_PATH, "utf-8"));
    return new Set(data);
  } catch {
    return new Set();
  }
}

function saveSeenIds(ids: Set<string>) {
  fs.mkdirSync(path.dirname(SEEN_POSTS_PATH), { recursive: true });
  fs.writeFileSync(SEEN_POSTS_PATH, JSON.stringify([...ids], null, 2) + "\n");
}

function postId(title: string, date: string): string {
  return `${date}::${title}`;
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

  await page.getByText("ログインする").click();
  await page.waitForURL(/\/(home|contact|timeline)/, { timeout: 30000 });
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

test("login and get contact comment", async ({ page }) => {
  await login(page);

  await page.goto("https://parents.codmon.com/contact", {
    waitUntil: "networkidle",
  });

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
    ? `📝 ${date} 連絡帳コメント\n${commentText}`
    : `⚠️ ${date} 連絡帳が未記入です`;

  console.log(message);

  if (SLACK_WEBHOOK_URL) {
    await sendToSlack(message);
  }
});

test("fetch unread home posts", async ({ page }) => {
  await login(page);

  await page.goto("https://parents.codmon.com/home", {
    waitUntil: "networkidle",
  });

  await page.getByRole("article").first().waitFor({ state: "attached", timeout: 15000 });

  const seenIds = loadSeenIds();

  const summaries = await page.evaluate(() => {
    const cards = document.querySelectorAll("[role='article']");
    return Array.from(cards).map((el, i) => ({
      index: i,
      type: el.querySelector(".timelineLabel")?.textContent?.trim() ?? "",
      date: el.querySelector(".homeCard_date")?.textContent?.trim() ?? "",
      title: el.querySelector(".homeCard__title")?.textContent?.trim() ?? "",
    }));
  });

  const unread = summaries.filter((s) => !seenIds.has(postId(s.title, s.date)));
  console.log(`記事数: ${summaries.length}, 未読: ${unread.length}`);

  const newPosts: Post[] = [];
  for (const item of unread) {
    await page.evaluate((idx) => {
      const cards = document.querySelectorAll("[role='article']");
      (cards[idx] as HTMLElement)?.click();
    }, item.index);

    await page.waitForSelector(".timelineDetails_title", { timeout: 15000 });
    await page.waitForSelector(".common__htmlContent", { timeout: 5000 }).catch(() => {});
    await page.waitForLoadState("networkidle");

    const detail = await page.evaluate(() => {
      const titleEl = document.querySelector(".timelineDetails_title");
      const bodyEl = document.querySelector(".common__htmlContent");
      return {
        title: titleEl?.textContent?.trim() ?? "",
        body: bodyEl?.textContent?.trim() ?? "",
      };
    });

    newPosts.push({
      title: detail.title || item.title,
      body: detail.body,
      date: item.date,
      type: item.type,
    });

    seenIds.add(postId(item.title, item.date));
    await page.goto("https://parents.codmon.com/home", { waitUntil: "networkidle" });
    await page.getByRole("article").first().waitFor({ state: "attached", timeout: 15000 });
  }

  saveSeenIds(seenIds);

  if (newPosts.length === 0) {
    console.log("新しいお知らせはありません");
  } else {
    console.log(`未読のお知らせ: ${newPosts.length}件`);
    for (const post of newPosts) {
      console.log("---");
      console.log(`[${post.type}] ${post.date}`);
      console.log(`タイトル: ${post.title}`);
      console.log(`本文: ${post.body}`);
    }
  }

  expect(seenIds.size).toBeGreaterThan(0);
});
