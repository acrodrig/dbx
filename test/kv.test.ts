#!/usr/bin/env -S deno test -A --unstable-kv

import { assertEquals, assertExists, assertFalse, assertObjectMatch, assertRejects } from "@std/assert";
import { KV } from "../src/kv.ts";

class Post {
  id!: number;
  title?: string;
  author?: string;
  date?: string;
  content?: string;
  hello() {
    return "hi";
  }
}

// deno-fmt-ignore
const DATA: Partial<Post>[] = [
  { "id": 1, "title": "My First Blog Post", "author": "John Doe", "date": "2022-01-01T12:00:00.000Z", "content": "This is my first blog post, I'm excited to share it with the world!" },
  { "id": 2, "title": "The Benefits of Meditation", "author": "Jane Smith", "date": "2022-01-05T14:00:00.000Z", "content": "Meditation has been a game-changer for me, I highly recommend it!" },
  { "id": 3, "title": "My Favorite Travel Destinations", "author": "Bob Johnson", "date": "2022-01-10T16:00:00.000Z", "content": "I've been lucky enough to travel to some amazing places, here are my top picks!" },
  { "id": 4, "title": "The Importance of Self-Care", "author": "Emily Chen", "date": "2022-01-15T18:00:00.000Z", "content": "Taking care of yourself is essential, don't forget to prioritize your own needs!" },
  { "id": 5, "title": "How I Overcame My Fears", "author": "Michael Brown", "date": "2022-01-20T20:00:00.000Z", "content": "I used to be held back by my fears, but I learned how to overcome them and now I'm unstoppable!" },
  { "id": 6, "title": "The Power of Positive Thinking", "author": "Sarah Lee", "date": "2022-01-25T22:00:00.000Z", "content": "Believe it or not, your thoughts have the power to shape your reality, so choose positivity!" },
  { "id": 7, "title": "My Favorite Books of All Time", "author": "David Kim", "date": "2022-02-01T00:00:00.000Z", "content": "I've read some amazing books over the years, here are my top picks!" },
  { "id": 8, "title": "The Benefits of Journaling", "author": "Lisa Nguyen", "date": "2022-02-05T02:00:00.000Z", "content": "Journaling has been a lifesaver for me, it helps me process my thoughts and emotions!" },
  { "id": 9, "title": "How to Stay Motivated", "author": "Tom Harris", "date": "2022-02-10T04:00:00.000Z", "content": "Staying motivated can be tough, but here are some tips that have worked for me!" },
  { "id": 10, "title": "My Favorite Quotes to Live By", "author": "Rachel Patel", "date": "2022-02-15T06:00:00.000Z", "content": "I love collecting inspiring quotes, here are some of my favorites!" }
];

// Insert 10 blog posts
const repo = new KV(Post, ["id"]);

await repo.delete();
for (const p of DATA) await repo.insert(p as Post);

Deno.test("count", async function () {
  assertEquals(await repo.count(), DATA.length);
  // assertEquals(await repo.count(Post, [], undefined, undefined, (p) => p.title!.startsWith("M")), 4);
});

Deno.test("delete", async function () {
  assertEquals(await repo.count(), DATA.length);
  assertEquals(await repo.deleteById(5), true);
  assertEquals(await repo.count(), DATA.length - 1);
  assertEquals(undefined, await repo.findById(5));
  await repo.insert(DATA[4] as Post);
  assertEquals(await repo.count(), DATA.length);
});

Deno.test("find", async function () {
  assertObjectMatch(await repo.findById(8) as Post, { title: "The Benefits of Journaling" });
  assertEquals(await repo.findById(42) as Post, undefined);
});

// Deno.test("findMany", async function () {
//   assertEquals((await repo.findMany(Post, [], [], [])).length, 0);
//   assertEquals((await repo.findMany(Post, [8], [2])).length, 2);
// });

Deno.test("insert", async function () {
  const post = { "id": 11, "title": "Oh!", "author": "Me" } as Post;
  await repo.insert(post);
  assertExists(await repo.findById(11) as Post);
  post.author = "You";
  await assertRejects(() => repo.insert(post), Error);
  await repo.deleteById(11);
  assertFalse(await repo.findById(11));
});

Deno.test("list", async function () {
  const posts = await repo.find();
  assertEquals(posts.length, DATA.length);
  assertEquals(posts.map((p) => p.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

Deno.test("update", async function () {
  await repo.updateById(8, { author: "me", foo: "bar" } as any);
  assertObjectMatch(await repo.findById(8) as Post, { author: "me", foo: "bar" });
  await repo.updateById(8, { author: "Lisa Nguyen", foo: undefined } as any);
  assertObjectMatch(await repo.findById(8) as Post, { author: "Lisa Nguyen" });
  assertFalse((await repo.findById(8) as any).foo);
});
