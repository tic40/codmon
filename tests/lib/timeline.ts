// codmon /api/v2/parent/timeline/ のレスポンス要素（利用するフィールドのみ）
export type TimelineItem = {
  id: string;
  kind: string;
  title: string | null;
  content: string | null;
  open_datetime: string;
};

export type Post = {
  id: string;
  type: string;
  title: string;
  body: string;
  date: string;
};

export type NotificationPlan = {
  toNotify: Post[];
  seen: Set<string>;
};

const SEEN_VERSION = 2;

// 4: 確認完了通知など詳細画面を持たないもの, 6: アンケート（従来から通知対象外）
const EXCLUDED_KINDS = new Set(["4", "6"]);
const KIND_LABELS: Record<string, string> = { "1": "お知らせ" };

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&quot;": '"',
  "&#39;": "'",
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
};

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&(nbsp|quot|#39|lt|gt|amp);/g, (e) => ENTITIES[e])
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function toPosts(items: TimelineItem[]): Post[] {
  return items
    .filter((i) => !EXCLUDED_KINDS.has(i.kind) && (i.title ?? "").trim() !== "")
    .map((i) => ({
      id: i.id,
      type: KIND_LABELS[i.kind] ?? "その他",
      title: (i.title ?? "").trim(),
      body: htmlToText(i.content ?? ""),
      date: i.open_datetime,
    }));
}

export function parseSeen(data: unknown): Set<string> | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const { version, ids } = data as { version?: unknown; ids?: unknown };
  if (version !== SEEN_VERSION || !Array.isArray(ids)) return null;
  return new Set(ids.map(String));
}

export function serializeSeen(ids: Set<string>): string {
  return JSON.stringify({ version: SEEN_VERSION, ids: [...ids].sort() }, null, 2) + "\n";
}

// seen が無い（初回・旧形式）場合は過去分を一斉通知しないよう、既読登録のみ行う
export function planNotification(posts: Post[], seen: Set<string> | null): NotificationPlan {
  const next = new Set(seen ?? []);
  const toNotify = seen ? posts.filter((p) => !seen.has(p.id)) : [];
  for (const p of posts) next.add(p.id);
  return { toNotify, seen: next };
}

export function formatMessage(posts: Post[]): string {
  const lines = posts.map((p) => `📢 [${p.type}] ${p.date}\n*${p.title}*\n\`\`\`${p.body}\`\`\``);
  return `新しいお知らせ ${posts.length}件\n\n${lines.join("\n---\n")}`;
}
