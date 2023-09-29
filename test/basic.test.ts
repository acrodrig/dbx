#!/usr/bin/env -S deno test -A --unstable

import { assert, assertEquals, assertExists } from "std/assert/mod.ts";
import { Schema } from "../src/types.ts";
import DB from "../src/db.ts";
import AccountModel from "../resources/account.ts";
import AccountSchema from "../resources/account.json" assert { type: "json" };
import { dbInit, getProvider } from "./helpers.ts";

const test = Deno.test;
const options = { sanitizeResources: false, sanitizeOps: false };

const NAME = "Testing Account for QA Team";

await dbInit(getProvider(), [AccountSchema as Schema]);

let id = -1;

const repo = await DB.getRepository(AccountModel);

test("Basic entity store/retrieve", options, async function () {
  let account = new AccountModel({ name: NAME });

  // Make sure the account established date has milliseconds
  account.established.setMilliseconds(123);

  // Save
  account = await repo.insert(account);
  id = account.id!;
  assertExists(id);
  assertEquals(account.country, "US");

  // Retrieve by ID
  account = await repo.findById(id) as AccountModel;
  assertExists(account);

  // // Make sure JSON is retrieved correctly
  assertEquals(account.preferences, { wrap: true, minAge: 18 });
});

test("Retrieve via generic find", options, async function () {
  const account = await repo.find({ where: { id } });
  assertEquals(account.length, 1);
});

test("Retrieve via another column", options, async function () {
  const account = await repo.findOne({ where: { name: NAME } }) as AccountModel;
  assertExists(account);
});

test("Retrieve via SQL query", options, async function () {
  const records = await DB.query(`SELECT * FROM Account WHERE name = ?`, [NAME]);
  const accounts = records.map((r) => new AccountModel(r as unknown as AccountModel));
  assertEquals(accounts.length, 1);
  assertEquals(accounts[0].name, NAME);
});

test("Boolean Values", options, async function () {
  const accounts = await repo.find({ where: { name: "xyz", enabled: true } });
  assertEquals(accounts.length, 0);
});

test("DateTime Values", options, async function () {
  // Milliseconds are preserved - except for MySQL :(
  if (DB.type === "mysql") return;
  const account = await repo.findOne({});
  assertEquals(account!.established.getMilliseconds(), 123);
});

test("Full Text search", options, async function () {
  const accounts = await repo.find({ where: { name: { match: "Team" } } });
  assertEquals(accounts.length, 1);
});

test("Multi Valued Index search", options, async function () {
  const accounts = await repo.find({ where: { valueList: { contains: "Huh?" } } });
  assertEquals(accounts.length, 0);
});

test("Query with raw SQL", options, async function () {
  const accounts = await repo.find({ where: { or: [{ name: "XYZ" }, { $sql: "(id BETWEEN -1000 AND 1000)" }] } });
  assertEquals(accounts.length, 1);
});

test("Find by ID and update", options, async function () {
  const comments = "Updating comment!";

  // Original account has no comment
  let account = await repo.findById(id) as AccountModel;
  assertEquals(account.comments, null);

  // Updated account has the right values
  account.comments = comments;
  account = await repo.update(account) as AccountModel;
  assertEquals(account.id, id);
  assertEquals(account.comments, comments);

  // Retrieved account also
  account = await repo.findById(id) as AccountModel;
  assertEquals(account.comments, comments);
});

test("Clean", options, async function () {
  const ok = await repo.deleteById(id);
  assert(ok);
});
