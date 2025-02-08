#!/usr/bin/env -S deno test -A --check

import type { JSONSchema7 } from "npm:@types/json-schema/7.0.15";
import AccountSchema from "../resources/account.json" with { type: "json" };

Deno.test("Schema Types are proper JSON Schema", function () {
  // Validate that property is a JSON Schema
  const _schema = AccountSchema as JSONSchema7;

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
