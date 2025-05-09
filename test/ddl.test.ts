#!/usr/bin/env -S deno test -A --no-check

import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
import { delay } from "@std/async";
import { hub } from "hub";
import { DDL } from "../src/ddl.ts";
import type { Schema } from "../src/types.ts";
import { createTables, dbInit, getProvider } from "./helpers.ts";

// deno-lint-ignore no-global-assign
console = hub("*", "debug");

// See https://github.com/denoland/deno_std/blob/main/testing/_diff_test.ts

const DB = await dbInit(getProvider());
const BASE = import.meta.dirname + "/../";

// Generator function is declared here so that it does not go into the published module
DDL.generator = async function (classFiles: Record<string, string>, base?: string) {
  const TJS = (await import("npm:typescript-json-schema@0.65.1")).default;
  const program = TJS.getProgramFromFiles(Object.values(classFiles), DDL.TS_OPTIONS, base);
  // deno-lint-ignore no-explicit-any
  const entries = Object.keys(classFiles).map((c) => [c, TJS.generateSchema(program, c, DDL.TJS_OPTIONS as any)]);
  return Object.fromEntries(entries);
};

// Import the static schema from the JSON file
import staticSchema from "../resources/account.json" with { type: "json" };

// Generate dynamic schema to make sure it's the same result
const classFiles: Record<string, string> = { Account: "resources/account.ts" };

// Track bug https://github.com/denoland/deno/issues/28206
// const { Account: dynamicSchema } = await DDL.generateSchemas(classFiles, import.meta.dirname! + "/../", true);
const dynamicSchemas = await DDL.generateSchemas(classFiles, BASE, true);
const dynamicSchema = dynamicSchemas.Account;

const SQLITE = `
CREATE TABLE IF NOT EXISTS accounts (
    id          INTEGER       NOT NULL PRIMARY KEY AUTOINCREMENT,
    etag        VARCHAR(128)          ,
    comments    VARCHAR(8192)         ,
    country     VARCHAR(128)  NOT NULL DEFAULT 'US',
    email       VARCHAR(128)           UNIQUE,
    established DATETIME(6)           ,
    enabled     BOOLEAN       NOT NULL DEFAULT true,
    externalId  VARCHAR(512)           UNIQUE,
    name        VARCHAR(128)  NOT NULL UNIQUE,
    phone       VARCHAR(128)          ,
    preferences JSON          NOT NULL DEFAULT ('{"wrap":true,"minAge":18}'),
    valueList   JSON                   GENERATED ALWAYS AS (JSON_EXTRACT(preferences, '$.*')) STORED,
    inserted    DATETIME               DEFAULT CURRENT_TIMESTAMP,
    updated     DATETIME               DEFAULT CURRENT_TIMESTAMP,
    CHECK (LENGTH(country) <= 2),
    CHECK (email IS NULL OR email REGEXP '^[^@]+@[^@]+[.][^@]{2,}$'),
    CHECK (established >= '2020-01-01'),
    CHECK (phone IS NULL OR phone REGEXP '^[0-9]{8,16}$')
);
CREATE INDEX accounts_id_valueList_enabled ON accounts (id,(CAST(valueList AS CHAR(32))),enabled);
CREATE INDEX accounts_inserted ON accounts (inserted);
CREATE INDEX accounts_phone ON accounts (phone);
CREATE INDEX accounts_updated ON accounts (updated);
`.trim();

Deno.test("Table Creation SQLite", function () {
  const sddl = DDL.createTable(staticSchema as Schema, "sqlite", "accounts");
  // console.debug(`\nSQLite\n${"-".repeat(80)}\n${sddl}\n\n`);
  assertEquals(sddl.trim(), SQLITE);
  const dddl = DDL.createTable(dynamicSchema as Schema, "sqlite", "accounts");
  // console.debug(`\nSQLite\n${"-".repeat(80)}\n${dddl}\n\n`);
  assertEquals(dddl.trim(), SQLITE);
});

const MYSQL = `
CREATE TABLE IF NOT EXISTS accounts (
    id          INTEGER       NOT NULL PRIMARY KEY AUTO_INCREMENT COMMENT 'Unique identifier, auto-generated. It''s the primary key.',
    etag        VARCHAR(128)           COMMENT 'Possible ETag for all resources that are external. Allows for better synch-ing.',
    comments    TEXT                   COMMENT 'General comments. Can be used for anything useful related to the instance.',
    country     VARCHAR(128)  NOT NULL DEFAULT 'US' COMMENT 'Country code',
    email       VARCHAR(128)           UNIQUE COMMENT 'Main email to communicate for that account',
    established DATETIME(6)            COMMENT 'Date on which the account was established',
    enabled     BOOLEAN       NOT NULL DEFAULT true COMMENT 'Whether it is enabled or not. Disabled instances will not be used.',
    externalId  VARCHAR(512)           UNIQUE COMMENT 'External unique ID, used to refer to external accounts',
    name        VARCHAR(128)  NOT NULL UNIQUE COMMENT 'Descriptive name to identify the instance',
    phone       VARCHAR(128)           COMMENT 'Phone associated with the account',
    preferences JSON          NOT NULL DEFAULT ('{"wrap":true,"minAge":18}') COMMENT 'All the general options associated with the account.',
    valueList   JSON                   GENERATED ALWAYS AS (JSON_EXTRACT(preferences, '$.*')) STORED COMMENT 'Auto-generated field with values',
    inserted    DATETIME               DEFAULT CURRENT_TIMESTAMP COMMENT 'Timestamp when current record is inserted',
    updated     DATETIME               DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Timestamp when current record is updated',
    CONSTRAINT accounts_country CHECK (LENGTH(country) <= 2),
    CONSTRAINT accounts_email CHECK (email IS NULL OR email REGEXP '^[^@]+@[^@]+[.][^@]{2,}$'),
    CONSTRAINT accounts_established CHECK (established >= '2020-01-01'),
    CONSTRAINT accounts_phone CHECK (phone IS NULL OR phone REGEXP '^[0-9]{8,16}$')
);
CREATE INDEX accounts_id_valueList_enabled ON accounts (id,(CAST(valueList AS CHAR(32) ARRAY)),enabled);
CREATE INDEX accounts_inserted ON accounts (inserted);
CREATE INDEX accounts_phone ON accounts (phone);
CREATE INDEX accounts_updated ON accounts (updated);
CREATE FULLTEXT INDEX accounts_fulltext ON accounts (comments,country,phone,name);
`.trim();

Deno.test("Table Creation MySQL", function () {
  const sddl = DDL.createTable(staticSchema as Schema, "mysql", "accounts");
  // console.debug(`\nMYSQL\n${"-".repeat(80)}\n${sddl}\n\n`);
  assertEquals(sddl.trim(), MYSQL);
  const dddl = DDL.createTable(dynamicSchema as Schema, "mysql", "accounts");
  // console.debug(`\nMYSQL\n${"-".repeat(80)}\n${dddl}\n\n`);
  assertEquals(dddl.trim(), MYSQL);
});

const POSTGRES = `
CREATE TABLE IF NOT EXISTS accounts (
    id          SERIAL        NOT NULL PRIMARY KEY,
    etag        VARCHAR(128)          ,
    comments    VARCHAR(8192)         ,
    country     VARCHAR(128)  NOT NULL DEFAULT 'US',
    email       VARCHAR(128)           UNIQUE,
    established TIMESTAMP(6)           ,
    enabled     BOOLEAN       NOT NULL DEFAULT true,
    externalId  VARCHAR(512)           UNIQUE,
    name        VARCHAR(128)  NOT NULL UNIQUE,
    phone       VARCHAR(128)          ,
    preferences JSONB         NOT NULL DEFAULT ('{"wrap":true,"minAge":18}'),
    valueList   JSONB                  GENERATED ALWAYS AS (JSONB_EXTRACT_PATH(preferences, '$.*')) STORED,
    inserted    TIMESTAMP               DEFAULT CURRENT_TIMESTAMP,
    updated     TIMESTAMP               DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT accounts_country CHECK (LENGTH(country) <= 2),
    CONSTRAINT accounts_email CHECK (email IS NULL OR email ~* '^[^@]+@[^@]+[.][^@]{2,}$'),
    CONSTRAINT accounts_established CHECK (established >= '2020-01-01'),
    CONSTRAINT accounts_phone CHECK (phone IS NULL OR phone ~* '^[0-9]{8,16}$')
);
CREATE INDEX accounts_id_valueList_enabled ON accounts (id,(CAST(valueList AS CHAR(32))),enabled);
CREATE INDEX accounts_inserted ON accounts (inserted);
CREATE INDEX accounts_phone ON accounts (phone);
CREATE INDEX accounts_updated ON accounts (updated);
CREATE INDEX accounts_fulltext ON accounts USING GIN (TO_TSVECTOR('english', COALESCE(comments,'')||' '||COALESCE(country,'')||' '||COALESCE(phone,'')||' '||COALESCE(name,'')));
`.trim();

Deno.test("Table Creation Postgres", function () {
  const sddl = DDL.createTable(staticSchema as Schema, "postgres");
  // console.debug(`\nPostgres\n${"-".repeat(80)}\n${sddl}\n\n`);
  assertEquals(sddl.trim(), POSTGRES);
  const dddl = DDL.createTable(dynamicSchema as Schema, "postgres");
  // console.debug(`\nPostgres\n${"-".repeat(80)}\n${dddl}\n\n`);
  assertEquals(dddl.trim(), POSTGRES);
});

// Execute the table creation on the provided platform
Deno.test("Actual Table", async function () {
  const provider = getProvider();
  await createTables([staticSchema as Schema]);

  let sql = "SELECT * FROM information_schema.tables WHERE table_name = 'accounts' OR table_name = 'account'";
  if (provider === "sqlite") sql = sql.replace("information_schema.tables", "information_schema_tables");

  // Select table from Information Schema
  const oneTable = await DB.query(sql);
  assertEquals(oneTable.length, 1);

  // Delete table
  await DB.execute("DROP TABLE accounts;");

  // Select table from Information Schema
  const noTable = await DB.query(sql);
  assertEquals(noTable.length, 0);
});

// Execute the table creation on the provided platform
Deno.test("Schema Generation", async function () {
  // Wait until the top of the second so that it runs within the same second
  await delay(1000 - (new Date()).getMilliseconds());

  // Generate two schemas in a row, they should be identical
  const first = await DDL.generateSchemas(classFiles, BASE, true);
  assertExists(first);
  const second = await DDL.generateSchemas(classFiles, BASE, true);
  assertNotEquals(first, second);
  assertEquals(JSON.stringify(first), JSON.stringify(second));
});

// Execute the table creation on the provided platform
Deno.test("Schema Outdated", async function () {
  // Generate schemas and save it
  let schemas = await DDL.generateSchemas(classFiles, BASE, true);
  Deno.writeTextFileSync("/tmp/schemas.json", JSON.stringify(schemas, null, 2));

  // Is it outdated from the get-go? No
  assertEquals(await DDL.outdatedSchemas(schemas, BASE), []);

  // Create other specific class called Point
  Deno.writeTextFileSync("/tmp/point.ts", "export default class Point { x = 0; y = 0; }");
  schemas = await DDL.generateSchemas({ ...classFiles, Point: "/tmp/point.ts" }, BASE, true);
  Deno.writeTextFileSync("/tmp/schemas.json", JSON.stringify(schemas, null, 2));
  assertEquals(Object.entries(schemas).length, 2);

  // Load the schema with a random query string to force a reload
  schemas = (await import("/tmp/schemas.json?force=" + Date.now(), { with: { type: "json" } })).default as Record<string, Schema>;
  assertEquals(Object.entries(schemas).length, 2);
  // console.log(JSON.stringify(schemas, null, 2));

  // They should not be outdated
  assertEquals(await DDL.outdatedSchemas(schemas, BASE), []);

  // Now make the point 3D
  Deno.writeTextFileSync("/tmp/point.ts", "export default class Point { x = 0; y = 0; z = 0; }");
  assertEquals(await DDL.outdatedSchemas(schemas, BASE), ["Point"]);
});

// Execute the table creation on the provided platform
Deno.test("Disconnect", { sanitizeResources: false, sanitizeOps: false }, async function () {
  await DB.disconnect();
});
