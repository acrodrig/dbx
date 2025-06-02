#!/usr/bin/env -S deno test -A

import { assert, assertEquals, assertExists, assertRejects } from "@std/assert";
import type { Schema } from "../src/types.ts";
import { dbInit, getProvider } from "./helpers.ts";
import Account from "../resources/account.ts";

const options = { sanitizeResources: false, sanitizeOps: false };

const NAME = "Testing Account for QA Team";

import schema from "../resources/account.json" with { type: "json" };
const DB = await dbInit(getProvider(), [schema as Schema]);

let id = -1;

const repo = DB.getRepository(Account);

Deno.test("Basic entity store/retrieve", options, async function () {
  let account = new Account({ name: NAME });

  // Make sure the account established date has milliseconds
  account.established!.setMilliseconds(123);

  // Save
  account = await repo.insert(account);
  id = account.id!;
  assertExists(id);
  assertEquals(account.country, "US");

  // Retrieve by ID
  account = await repo.findById(id) as Account;
  assertExists(account);

  // Retrieve by String ID (using lax SQL parameter parsing)
  account = await repo.findById(id.toString()) as Account;
  assertExists(account);

  // // Make sure JSON is retrieved correctly
  assertEquals(account.preferences, { wrap: true, minAge: 18 });
});

Deno.test("Retrieve via generic find", options, async function () {
  const account = await repo.find({ where: { id } });
  assertEquals(account.length, 1);
});

Deno.test("Retrieve via simplified filter (where clause)", options, async function () {
  const account = await repo.find({ id });
  assertEquals(account.length, 1);
});

Deno.test("Retrieve via another column", options, async function () {
  const account = await repo.findOne({ where: { name: NAME } }) as Account;
  assertExists(account);
});

Deno.test("Retrieve via SQL query", options, async function () {
  const records = await DB.query(`SELECT * FROM accounts WHERE name = ?`, [NAME]);
  const accounts = records.map((r) => new Account(r as unknown as Account));
  assertEquals(accounts.length, 1);
  assertEquals(accounts[0].name, NAME);
});

Deno.test("Retrieve via SQL query with named parameter(s)", options, async function () {
  const records = await DB.query(`SELECT * FROM accounts WHERE name = :n`, { n: NAME });
  assertEquals(records.length, 1);
});

Deno.test("Boolean Values", options, async function () {
  const accounts = await repo.find({ name: "xyz", enabled: true });
  assertEquals(accounts.length, 0);
});

Deno.test("DateTime Values (including Temporal)", options, async function () {
  const account = await repo.findOne();
  assertEquals(account!.established!.getMilliseconds(), 123);

  // Using actual dates
  assertEquals(await repo.count({ established: { lt: new Date("2000-01-01") } }), 0);
  assertEquals(await repo.count({ established: { lt: new Date("2100-01-01") } }), 1);

  // Execute in a more raw form to test temporal parameters
  // const sql = "SELECT COUNT(1) AS count FROM accounts WHERE established < ?";
  // assertEquals(await DB.query(sql, [Temporal.PlainDate.from("2000-01-01")]), [{ count: 0 }]);
  // assertEquals(await DB.query(sql, ["2100-01-01"]), [{ count: 1 }]);
});

Deno.test("Full Text search", options, async function () {
  const accounts = await repo.find({ where: { name: { match: "Team" } } });
  assertEquals(accounts.length, 1);
});

Deno.test("Multi Valued Index search", options, async function () {
  const accounts = await repo.find({ where: { valueList: { contains: "Huh?" } } });
  assertEquals(accounts.length, 0);
});

Deno.test("Query with raw SQL", options, async function () {
  const accounts = await repo.find({ where: { or: [{ name: "XYZ" }, { $sql: "(id BETWEEN -1000 AND 1000)" }] } });
  assertEquals(accounts.length, 1);
});

Deno.test("Count via where", options, async function () {
  assertEquals(await repo.count({ name: NAME }), 1);
  assertEquals(await repo.count({ name: "XYZ" }), 0);
});

Deno.test("Find by ID and update", options, async function () {
  const comments = "Updating comment!";

  // Original account has no comment
  let account = await repo.findById(id) as Account;
  assertEquals(account.comments, null);

  // Updated account has the right values
  account.comments = comments;
  account = await repo.update(account) as Account;
  assertEquals(account.id, id);
  assertEquals(account.comments, comments);

  // Retrieved account also
  account = await repo.findById(id) as Account;
  assertEquals(account.comments, comments);
});

Deno.test("Constraint(s)", options, async function () {
  assert(await repo.insert(new Account({ name: Math.random().toString() })));
  await assertRejects(() => repo.insert(new Account({ name: Math.random().toString(), email: "me" })));
  await assertRejects(() => repo.insert(new Account({ name: Math.random().toString(), country: "United States" })));
});

Deno.test("Errors", options, async function () {
  await assertRejects(() => DB.query("SELECT 1 AND 1 FROM foo", {}), Error);
});

Deno.test("Clean", options, async function () {
  const ok = await repo.deleteById(id);
  assert(ok);
});
