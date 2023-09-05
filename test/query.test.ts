#!/usr/bin/env -S deno test -A --no-check

import { assert, assertEquals } from "std/assert/mod.ts";
import DB from "../src/db.ts";
import { dbExec, dbInit, getProvider } from "./helpers.ts";

const test = Deno.test;
const options = { sanitizeResources: false, sanitizeOps: false };

// See https://lucy-kim.github.io/pages/learn-mySQL.html

await dbInit(getProvider(), []);

const DATA = Deno.readTextFileSync(new URL("../resources/data.sql", import.meta.url));

const repo = await DB.getRepository("Employees");

// Ensure DB exists and it is initialized
let sql = "SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE LOWER(TABLE_NAME) = 'employees'";
if (DB.type === "sqlite") sql = "SELECT * FROM sqlite_master WHERE type = 'table' AND name = 'employees'";

try {
  const data = await DB.query(sql);
  if (data.length === 0) await dbExec(DATA);
} catch (ex) {
  console.error(ex);
  console.error("\n❌ Cannot execute SQL initialization in on target DB '" + getProvider() + "'\n");
  Deno.exit(1);
}

test("Ensure DB data", options, async function () {
  const rows = await DB.query("SELECT 1 FROM Employees");
  assertEquals(rows.length, 14);
});

test("Select all employees", options, async function () {
  const employees = await repo.all();
  assertEquals(employees.length, 14);
});

test("Select employees with salary less than 1000", options, async function () {
  const employees = await repo.find({ where: { sal: { lt: 1000 } } });
  assertEquals(employees.length, 2);
  assert(employees.every((e) => e.sal < 1000));
});

test("Query employees with salary more than 1000", options, async function () {
  const employees = await DB.query("SELECT * FROM Employees WHERE sal > :minSal", { minSal: 1000 });
  assertEquals(employees.length, 12);
});
