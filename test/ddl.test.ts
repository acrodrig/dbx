#!/usr/bin/env -S deno test -A --no-check

import { assertEquals } from "std/assert/mod.ts";
import { Schema } from "../src/types.ts";
import AccountSchema from "../resources/account.json" assert { type: "json" };
import { DDL } from "../src/ddl.ts";

// See https://github.com/denoland/deno_std/blob/main/testing/_diff_test.ts

const test = Deno.test;

const DEBUG = Deno.env.get("DEBUG") !== undefined;
const HR = "-".repeat(80);

const MYSQL = `
CREATE TABLE IF NOT EXISTS TestAccount (
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
    name        VARCHAR(128) NOT NULL UNIQUE COMMENT 'Descriptive name to identify the instance',
    preferences JSON NOT NULL DEFAULT ('{"wrap":true,"minAge":18}') COMMENT 'All the general options associated with the account.',
    valueList   JSON GENERATED ALWAYS AS (JSON_EXTRACT(preferences, '$.*')) STORED,
    INDEX inserted (inserted),
    INDEX updated (updated),
    INDEX valueList (id,(CAST(valueList AS CHAR(32) ARRAY)),enabled),
    FULLTEXT  (comments,country,phone,name),
    CONSTRAINT account_email CHECK (email IS NULL OR email RLIKE '^[^@]+@[^@]+[.][^@]{2,}$'),
    CONSTRAINT account_phone CHECK (phone IS NULL OR phone RLIKE '^[0-9]{8,16}$')
);
`.trim();

test("Table Creation MySQL", function () {
  const ddl = DDL.createTable(AccountSchema as Schema, "mysql", "TestAccount");
  if (DEBUG) console.log(`\nMYSQL\n${HR}\n${ddl}\n\n`);
  assertEquals(ddl.trim(), MYSQL);
});

const SQLITE = `
CREATE TABLE IF NOT EXISTS TestAccount (
    id          INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    inserted    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated     DATETIME DEFAULT CURRENT_TIMESTAMP,
    etag        VARCHAR(1024),
    comments    VARCHAR(8192),
    country     VARCHAR(16) NOT NULL DEFAULT 'US',
    email       VARCHAR(128) UNIQUE,
    established DATETIME,
    enabled     BOOLEAN NOT NULL DEFAULT true,
    externalId  VARCHAR(512) UNIQUE,
    phone       VARCHAR(128),
    name        VARCHAR(128) NOT NULL UNIQUE,
    preferences JSON NOT NULL DEFAULT ('{"wrap":true,"minAge":18}'),
    valueList   JSON GENERATED ALWAYS AS (JSON_EXTRACT(preferences, '$.*')) STORED
);
CREATE INDEX IF NOT EXISTS TestAccount_inserted ON TestAccount (inserted);
CREATE INDEX IF NOT EXISTS TestAccount_updated ON TestAccount (updated);
CREATE INDEX IF NOT EXISTS TestAccount_valueList ON TestAccount (id,(CAST(valueList AS CHAR(32))),enabled);
`.trim();

test("Table Creation SQLite", function () {
  const ddl = DDL.createTable(AccountSchema as Schema, "sqlite", "TestAccount");
  if (DEBUG) console.log(`\nSQLite\n${HR}\n${ddl}\n\n`);
  assertEquals(ddl.trim(), SQLITE);
});

const RLIKE = "~*";

const POSTGRES = `
CREATE TABLE IF NOT EXISTS TestAccount (
    id          SERIAL,
    inserted    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    etag        VARCHAR(1024),
    comments    VARCHAR(8192),
    country     VARCHAR(16) NOT NULL DEFAULT 'US',
    email       VARCHAR(128) UNIQUE,
    established TIMESTAMP,
    enabled     BOOLEAN NOT NULL DEFAULT true,
    externalId  VARCHAR(512) UNIQUE,
    phone       VARCHAR(128),
    name        VARCHAR(128) NOT NULL UNIQUE,
    preferences JSON NOT NULL DEFAULT ('{"wrap":true,"minAge":18}'),
    valueList   JSON GENERATED ALWAYS AS (JSON_EXTRACT_PATH(preferences, '$.*')) STORED,
    CONSTRAINT account_email CHECK (email IS NULL OR email ${RLIKE} '^[^@]+@[^@]+[.][^@]{2,}$'),
    CONSTRAINT account_phone CHECK (phone IS NULL OR phone ${RLIKE} '^[0-9]{8,16}$')
);
CREATE INDEX IF NOT EXISTS TestAccount_inserted ON TestAccount (inserted);
CREATE INDEX IF NOT EXISTS TestAccount_updated ON TestAccount (updated);
CREATE INDEX IF NOT EXISTS TestAccount_valueList ON TestAccount (id,(CAST(valueList AS CHAR(32))),enabled);
`.trim();

test("Table Creation Postgres", function () {
  const ddl = DDL.createTable(AccountSchema as Schema, "postgres", "TestAccount");
  if (DEBUG) console.log(`\nPostgres\n${HR}\n${ddl}\n\n`);
  assertEquals(ddl.trim(), POSTGRES);
});
