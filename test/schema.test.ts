#!/usr/bin/env -S deno test -A --check

import { JSONSchema7 } from "schema";
import AccountSchema from "../resources/account.json" with { type: "json" };

const test = Deno.test;

test("Schema Types are proper JSON Schema", function () {
  // Validate that property is a JSON Schema
  const _schema = AccountSchema as JSONSchema7;

  // By compiling we check that all columns are properties
  const _id = _schema.properties.id as JSONSchema7;
  const _inserted = _schema.properties.inserted as JSONSchema7;
  const _updated = _schema.properties.updated as JSONSchema7;
  const _etag = _schema.properties.etag as JSONSchema7;
  const _comments = _schema.properties.comments as JSONSchema7;
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
