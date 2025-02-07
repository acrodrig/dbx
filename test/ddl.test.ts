#!/usr/bin/env -S deno test -A --no-check

import { assertEquals } from "@std/assert";
import { DDL } from "../src/ddl.ts";
import type { Schema } from "../src/types.ts";
import { createTables, dbInit, getProvider } from "./helpers.ts";
import AccountSchema from "../resources/account.json" with { type: "json" };

// See https://github.com/denoland/deno_std/blob/main/testing/_diff_test.ts

const test = Deno.test;

const DEBUG = Deno.env.get("DEBUG") !== undefined;
const HR = "-".repeat(80);

const DB = await dbInit(getProvider());

const SQLITE = `
CREATE TABLE IF NOT EXISTS accounts (
    id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    inserted    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated     DATETIME DEFAULT CURRENT_TIMESTAMP,
    etag        VARCHAR(1024),
    comments    VARCHAR(8192),
    country     VARCHAR(16) NOT NULL DEFAULT 'US',
    email       VARCHAR(128) UNIQUE,
    established DATETIME(6),
    enabled     BOOLEAN NOT NULL DEFAULT true,
    externalId  VARCHAR(512) UNIQUE,
    phone       VARCHAR(128),
    name        VARCHAR(256) NOT NULL UNIQUE,
    preferences JSON NOT NULL DEFAULT ('{"wrap":true,"minAge":18}'),
    valueList   JSON GENERATED ALWAYS AS (JSON_EXTRACT(preferences, '$.*')) STORED
);
CREATE INDEX accounts_inserted ON accounts (inserted);
CREATE INDEX accounts_updated ON accounts (updated);
CREATE INDEX accounts_valueList ON accounts (id,(CAST(valueList AS CHAR(32))),enabled);
`.trim();

test("Table Creation SQLite", function () {
  const ddl = DDL.createTable(AccountSchema as Schema, "sqlite", "accounts");
  if (DEBUG) console.log(`\nSQLite\n${HR}\n${ddl}\n\n`);
  assertEquals(ddl.trim(), SQLITE);
});

const MYSQL = `
CREATE TABLE IF NOT EXISTS accounts (
    id          INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT COMMENT 'Unique identifier, auto-generated. It''s the primary key.',
    inserted    DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'Timestamp when current record is inserted',
    updated     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Timestamp when current record is updated',
    etag        VARCHAR(1024) COMMENT 'Possible ETag for all resources that are external. Allows for better synch-ing.',
    comments    VARCHAR(8192) COMMENT 'General comments. Can be used for anything useful related to the instance.',
    country     VARCHAR(16) NOT NULL DEFAULT 'US' COMMENT 'Country code',
    email       VARCHAR(128) UNIQUE COMMENT 'Main email to communicate for that account',
    established DATETIME(6) COMMENT 'Date on which the account was established',
    enabled     BOOLEAN NOT NULL DEFAULT true COMMENT 'Whether it is enabled or not. Disabled instances will not be used.',
    externalId  VARCHAR(512) UNIQUE COMMENT 'External unique ID, used to refer to external accounts',
    phone       VARCHAR(128) COMMENT 'Handle associated with the account',
    name        VARCHAR(256) NOT NULL UNIQUE COMMENT 'Descriptive name to identify the instance',
    preferences JSON NOT NULL DEFAULT ('{"wrap":true,"minAge":18}') COMMENT 'All the general options associated with the account.',
    valueList   JSON GENERATED ALWAYS AS (JSON_EXTRACT(preferences, '$.*')) STORED,
    CONSTRAINT accounts_established CHECK (established >= '2020-01-01'),
    CONSTRAINT accounts_email CHECK (email IS NULL OR email RLIKE '^[^@]+@[^@]+[.][^@]{2,}$'),
    CONSTRAINT accounts_phone CHECK (phone IS NULL OR phone RLIKE '^[0-9]{8,16}$')
);
CREATE INDEX accounts_inserted ON accounts (inserted);
CREATE INDEX accounts_updated ON accounts (updated);
CREATE INDEX accounts_valueList ON accounts (id,(CAST(valueList AS CHAR(32) ARRAY)),enabled);
CREATE FULLTEXT INDEX accounts_fulltext ON accounts (comments,country,phone,name);
`.trim();

test("Table Creation MySQL/MySQL2", function () {
  const ddl = DDL.createTable(AccountSchema as Schema, "mysql", "accounts");
  if (DEBUG) console.log(`\nMYSQL\n${HR}\n${ddl}\n\n`);
  assertEquals(ddl.trim(), MYSQL);
});

const POSTGRES = `
CREATE TABLE IF NOT EXISTS accounts (
    id          SERIAL NOT NULL PRIMARY KEY,
    inserted    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    etag        VARCHAR(1024),
    comments    VARCHAR(8192),
    country     VARCHAR(16) NOT NULL DEFAULT 'US',
    email       VARCHAR(128) UNIQUE,
    established TIMESTAMP(6),
    enabled     BOOLEAN NOT NULL DEFAULT true,
    externalId  VARCHAR(512) UNIQUE,
    phone       VARCHAR(128),
    name        VARCHAR(256) NOT NULL UNIQUE,
    preferences JSONB NOT NULL DEFAULT ('{"wrap":true,"minAge":18}'),
    valueList   JSONB GENERATED ALWAYS AS (JSONB_EXTRACT_PATH(preferences, '$.*')) STORED,
    CONSTRAINT accounts_established CHECK (established >= '2020-01-01'),
    CONSTRAINT accounts_email CHECK (email IS NULL OR email ~* '^[^@]+@[^@]+[.][^@]{2,}$'),
    CONSTRAINT accounts_phone CHECK (phone IS NULL OR phone ~* '^[0-9]{8,16}$')
);
CREATE INDEX accounts_inserted ON accounts (inserted);
CREATE INDEX accounts_updated ON accounts (updated);
CREATE INDEX accounts_valueList ON accounts (id,(CAST(valueList AS CHAR(32))),enabled);
CREATE INDEX accounts_fulltext ON accounts USING GIN (TO_TSVECTOR('english', COALESCE(comments,'')||' '||COALESCE(country,'')||' '||COALESCE(phone,'')||' '||COALESCE(name,'')));
`.trim();

test("Table Creation Postgres", function () {
  const ddl = DDL.createTable(AccountSchema as Schema, "postgres");
  if (DEBUG) console.log(`\nPostgres\n${HR}\n${ddl}\n\n`);
  assertEquals(ddl.trim(), POSTGRES);
});

// Execute the table creation on the provided platform
test("Actual Table", async function () {
  const provider = getProvider();
  await createTables([AccountSchema as Schema]);

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

  await DB.disconnect();
});
