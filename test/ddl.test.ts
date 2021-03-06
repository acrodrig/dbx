#!/usr/bin/env -S deno test -A --no-check

import { assertEquals } from "./deps.ts";
import { Schema } from "../src/types.ts";
import DB from "../src/db.ts";
import AccountSchema from "../resources/account.json" assert { type: "json" };

// See https://github.com/denoland/deno_std/blob/main/testing/_diff_test.ts

const test = Deno.test;

const DEBUG = Deno.env.get("DEBUG") !== undefined;
const HR = "-".repeat(80);

const MYSQL= `
CREATE TABLE IF NOT EXISTS TestAccount (
    id          INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT COMMENT 'Unique identifier, auto-generated. It''s the primary key.',
    inserted    DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'Timestamp when current record is inserted',
    updated     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Timestamp when current record is updated',
    etag        VARCHAR(1024) COMMENT 'Possible ETag for all resources that are external. Allows for better synch-ing.',
    comments    VARCHAR(8192) COMMENT 'General comments. Can be used for anything useful related to the instance.',
    country     VARCHAR(16) NOT NULL DEFAULT 'US' COMMENT 'Country code',
    email       VARCHAR(128) UNIQUE COMMENT 'Main email to communicate for that account',
    enabled     BOOLEAN NOT NULL DEFAULT true COMMENT 'Whether it is enabled or not. Disabled instances will not be used.',
    externalId  VARCHAR(512) UNIQUE COMMENT 'External unique ID, used to refer to external accounts',
    phone       VARCHAR(128) COMMENT 'Handle associated with the account',
    name        VARCHAR(128) NOT NULL UNIQUE COMMENT 'Descriptive name to identify the instance',
    preferences JSON NOT NULL DEFAULT ('{"wrap":true,"minAge":18}') COMMENT 'All the general options associated with the account.',
    keyList     JSON AS (JSON_KEYS(preferences)) STORED,
    INDEX inserted (inserted),
    INDEX updated (updated),
    INDEX keyList (id,(CAST(keyList AS UNSIGNED ARRAY)),enabled),
    FULLTEXT  (comments,country,phone,name),
    CONSTRAINT account_email CHECK (email IS NULL OR email RLIKE '^[^@]+@[^@]+[.][^@]{2,}$'),
    CONSTRAINT account_phone CHECK (phone IS NULL OR phone RLIKE '^[0-9]{8,16}$')
);
`.trim();

test("Table Creation MySQL", function() {
    const ddl = DB.createTable(AccountSchema as Schema, "mysql", false, "TestAccount");
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
    enabled     BOOLEAN NOT NULL DEFAULT true,
    externalId  VARCHAR(512) UNIQUE,
    phone       VARCHAR(128),
    name        VARCHAR(128) NOT NULL UNIQUE,
    preferences JSON NOT NULL DEFAULT ('{"wrap":true,"minAge":18}'),
    keyList     JSON AS (JSON_KEYS(preferences)) STORED
);
CREATE INDEX IF NOT EXISTS TestAccount_inserted ON TestAccount (inserted);
CREATE INDEX IF NOT EXISTS TestAccount_updated ON TestAccount (updated);
CREATE INDEX IF NOT EXISTS TestAccount_keyList ON TestAccount (id,keyList,enabled);
`.trim();

test("Table Creation SQLite", function() {
    const ddl = DB.createTable(AccountSchema as Schema, "sqlite", false, "TestAccount");
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
    enabled     BOOLEAN NOT NULL DEFAULT true,
    externalId  VARCHAR(512) UNIQUE,
    phone       VARCHAR(128),
    name        VARCHAR(128) NOT NULL UNIQUE,
    preferences JSON NOT NULL DEFAULT ('{"wrap":true,"minAge":18}'),
    keyList     JSON AS (JSON_KEYS(preferences)) STORED,
    CONSTRAINT account_email CHECK (email IS NULL OR email ${RLIKE} '^[^@]+@[^@]+[.][^@]{2,}$'),
    CONSTRAINT account_phone CHECK (phone IS NULL OR phone ${RLIKE} '^[0-9]{8,16}$')
);
CREATE INDEX IF NOT EXISTS TestAccount_inserted ON TestAccount (inserted);
CREATE INDEX IF NOT EXISTS TestAccount_updated ON TestAccount (updated);
CREATE INDEX IF NOT EXISTS TestAccount_keyList ON TestAccount (id,keyList,enabled);
`.trim();

test("Table Creation Postgres", function() {
    const ddl = DB.createTable(AccountSchema as Schema, "postgres", false, "TestAccount");
    if (DEBUG) console.log(`\nPostgres\n${HR}\n${ddl}\n\n`);
    assertEquals(ddl.trim(), POSTGRES);
});
