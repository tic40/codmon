import { test, expect } from "@playwright/test";
import {
  TimelineItem,
  toPosts,
  htmlToText,
  parseSeen,
  serializeSeen,
  planNotification,
  formatMessage,
  Post,
} from "./timeline";

function item(overrides: Partial<TimelineItem> = {}): TimelineItem {
  return {
    id: "1",
    kind: "1",
    title: "タイトル",
    content: "<p>本文</p>",
    open_datetime: "2026-11-12 16:00:56",
    ...overrides,
  };
}

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: "1",
    type: "お知らせ",
    title: "タイトル",
    body: "本文",
    date: "2026-11-12 16:00:56",
    ...overrides,
  };
}

test.describe("htmlToText", () => {
  test("strips tags and decodes entities", () => {
    expect(htmlToText("<p><strong>A</strong>&nbsp;&quot;B&quot; &amp; &lt;C&gt; &#39;D&#39;</p>")).toBe(
      `A "B" & <C> 'D'`
    );
  });

  test("turns br and block ends into newlines and trims", () => {
    expect(htmlToText("<p>1行目<br>2行目<br/>3行目</p><div>4行目</div><p></p><p></p><p>5行目</p>\n")).toBe(
      "1行目\n2行目\n3行目\n4行目\n\n5行目"
    );
  });
});

test.describe("toPosts", () => {
  test("maps お知らせ items to posts", () => {
    expect(toPosts([item({ id: "194159415", title: " なかよし兄弟 ", content: "<p>今日は</p>" })])).toEqual([
      {
        id: "194159415",
        type: "お知らせ",
        title: "なかよし兄弟",
        body: "今日は",
        date: "2026-11-12 16:00:56",
      },
    ]);
  });

  test("excludes kinds without a detail view and items without a title", () => {
    const items = [
      item({ id: "a", kind: "4", title: null }),
      item({ id: "b", kind: "6", title: "アンケート" }),
      item({ id: "c", title: null }),
      item({ id: "d", title: "  " }),
      item({ id: "e", kind: "99", title: "未知の種別" }),
    ];
    expect(toPosts(items).map((p) => [p.id, p.type])).toEqual([["e", "その他"]]);
  });

  test("treats null content as empty body", () => {
    expect(toPosts([item({ content: null })])[0].body).toBe("");
  });
});

test.describe("seen state", () => {
  test("round-trips ids", () => {
    const json = serializeSeen(new Set(["2", "1"]));
    expect(parseSeen(JSON.parse(json))).toEqual(new Set(["1", "2"]));
    expect(json.endsWith("\n")).toBe(true);
  });

  test("returns null for legacy array format and invalid data", () => {
    expect(parseSeen(["タイトル::本文"])).toBeNull();
    expect(parseSeen(null)).toBeNull();
    expect(parseSeen({ version: 1, ids: [] })).toBeNull();
    expect(parseSeen({ version: 2, ids: "x" })).toBeNull();
  });
});

test.describe("planNotification", () => {
  test("notifies posts not yet seen and adds them to seen", () => {
    const posts = [post({ id: "1" }), post({ id: "2" })];
    const plan = planNotification(posts, new Set(["1"]));
    expect(plan.toNotify.map((p) => p.id)).toEqual(["2"]);
    expect(plan.seen).toEqual(new Set(["1", "2"]));
  });

  test("distinguishes posts with identical title and body by id", () => {
    const posts = [post({ id: "new" })];
    const plan = planNotification(posts, new Set(["old"]));
    expect(plan.toNotify.map((p) => p.id)).toEqual(["new"]);
  });

  test("seeds seen without notifying when there is no seen state", () => {
    const plan = planNotification([post({ id: "1" }), post({ id: "2" })], null);
    expect(plan.toNotify).toEqual([]);
    expect(plan.seen).toEqual(new Set(["1", "2"]));
  });

  test("does not mutate the given seen set", () => {
    const seen = new Set(["1"]);
    planNotification([post({ id: "2" })], seen);
    expect(seen).toEqual(new Set(["1"]));
  });
});

test.describe("formatMessage", () => {
  test("formats posts for slack", () => {
    expect(formatMessage([post({ title: "A", body: "a" }), post({ type: "その他", title: "B", body: "b" })])).toBe(
      "新しいお知らせ 2件\n\n" +
        "📢 [お知らせ] 2026-11-12 16:00:56\n*A*\n```a```\n---\n" +
        "📢 [その他] 2026-11-12 16:00:56\n*B*\n```b```"
    );
  });
});
