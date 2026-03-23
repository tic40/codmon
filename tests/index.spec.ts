import { test, expect, Page } from "@playwright/test";

const {
  CODMON_LOGIN_URL = "https://parents.codmon.com",
  CODMON_EMAIL = "",
  CODMON_PW = "",
  SLACK_WEBHOOK_URL = "",
} = process.env;

async function login(page: Page) {
  await page.goto(CODMON_LOGIN_URL, { waitUntil: "networkidle" });

  // 「すでにアカウントをお持ちの方」をクリックしてログインフォームへ遷移
  await page.getByText("すでにアカウントをお持ちの方").click();

  // ログインフォームに入力
  await page.getByPlaceholder("メールアドレス").fill(CODMON_EMAIL);
  await page.getByPlaceholder("パスワード").fill(CODMON_PW);
  await page.getByText("ログインする").click();

  // ログイン後のページ読み込みを待機
  await page.waitForURL("**/home**", { timeout: 15000 });
}

async function sendToSlack(username: string, text: string, channel: string) {
  const res = await fetch(SLACK_WEBHOOK_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, text, channel }),
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

test("login and get info", async ({ page }) => {
  await login(page);

  // TODO: ログイン後に取得したい情報のセレクタを追加
  // 例: 連絡帳、お知らせ、スケジュールなど
  const title = await page.title();
  console.log("Page title:", title);

  // ページ内容のスクリーンショットを保存（デバッグ用）
  await page.screenshot({ path: "test-results/after-login.png", fullPage: true });
});
