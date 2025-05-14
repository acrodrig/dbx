#!/usr/bin/env -S deno test -A --no-check

import { assertEquals, assertExists, assertNotEquals } from "@std/assert";
import type { JSONSchema7 } from "npm:@types/json-schema/7.0.15";
import { delay } from "@std/async";
import { Schemas } from "../src/schemas.ts";
import type { Schema } from "../src/types.ts";
import { generator } from "./helpers.ts";

// See https://github.com/denoland/deno_std/blob/main/testing/_diff_test.ts

const BASE = import.meta.dirname + "/../";

// Generate dynamic schema to make sure it's the same result
const classFiles: Record<string, string> = { Account: "resources/account.ts" };

import schema from "../resources/account.json" with { type: "json" };

Deno.test("Schema Types are proper JSON Schema", function () {
  // Validate that property is a JSON Schema
  const _schema = schema as JSONSchema7;

  // By compiling we check that all columns are properties
  const _id = _schema.properties.id as JSONSchema7;
  const _inserted = _schema.properties.inserted as JSONSchema7;
  const _updated = _schema.properties.updated as JSONSchema7;
  const _etag = _schema.properties.etag as JSONSchema7;
  const _description = _schema.properties.description as JSONSchema7;
  const _country = _schema.properties.country as JSONSchema7;
  const _email = _schema.properties.email as JSONSchema7;
  const _established = _schema.properties.established as JSONSchema7;
  const _enabled = _schema.properties.enabled as JSONSchema7;
  const _externalId = _schema.properties.externalId as JSONSchema7;
  const _phone = _schema.properties.phone as JSONSchema7;
  const _name = _schema.properties.name as JSONSchema7;
  const _preferences = _schema.properties.preferences as JSONSchema7;
  const _valueList = _schema.properties.valueList as JSONSchema7;
});

// Execute the table creation on the provided platform
Deno.test("Schema Generation", async function () {
  // Wait until the top of the second so that it runs within the same second
  await delay(1000 - (new Date()).getMilliseconds());

  // Generate two schemas in a row, they should be identical
  const first = await Schemas.generate(classFiles, generator, BASE, true);
  assertExists(first);
  const second = await Schemas.generate(classFiles, generator, BASE, true);
  assertNotEquals(first, second);
  assertEquals(JSON.stringify(first), JSON.stringify(second));
});

// Execute the table creation on the provided platform
Deno.test("Schema Outdated", async function () {
  // Generate schemas and save it
  let schemas = await Schemas.generate(classFiles, generator, BASE, true);
  Deno.writeTextFileSync("/tmp/schemas.json", JSON.stringify(schemas, null, 2));

  // Is it outdated from the get-go? No
  assertEquals(await Schemas.outdatedSchemas(schemas, BASE), []);

  // Create other specific class called Point
  Deno.writeTextFileSync("/tmp/point.ts", "export default class Point { x = 0; y = 0; }");
  schemas = await Schemas.generate({ ...classFiles, Point: "/tmp/point.ts" }, generator, BASE, true);
  Deno.writeTextFileSync("/tmp/schemas.json", JSON.stringify(schemas, null, 2));
  assertEquals(Object.entries(schemas).length, 2);

  // Load the schema with a random query string to force a reload
  schemas = (await import("/tmp/schemas.json?force=" + Date.now(), { with: { type: "json" } })).default as Record<string, Schema>;
  assertEquals(Object.entries(schemas).length, 2);
  // console.log(JSON.stringify(schemas, null, 2));

  // They should not be outdated
  assertEquals(await Schemas.outdatedSchemas(schemas, BASE), []);

  // Now make the point 3D
  Deno.writeTextFileSync("/tmp/point.ts", "export default class Point { x = 0; y = 0; z = 0; }");
  assertEquals(await Schemas.outdatedSchemas(schemas, BASE), ["Point"]);
});
