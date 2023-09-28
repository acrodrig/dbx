#!/usr/bin/env -S deno test -A --no-check

import { assertEquals, assertThrows } from "std/assert/mod.ts";
import { Repository } from "../src/repository.ts";
import DB from "../src/db.ts";

const test = Deno.test;

test("Test _where (with NO META ??)", function () {
  const where = Repository._where, now = new Date();
  let tree: unknown[];
  assertEquals(where({ a: 1, b: 2 }, tree = []), "a = ? AND b = ?");
  assertEquals(tree, [1, 2]);
  assertEquals(where({ a: null, c: { gt: 3 }, or: [{ x: "X" }, { d: { lte: now } }] }, tree = []), "a IS ? AND c > ? AND (x = ? OR d <= ?)");
  assertEquals(tree, [null, 3, "X", now]);
});

test("Test _transformParameters", function () {
  const transformParameters = DB._transformParameters;
  let array: unknown[];

  // Simple one to one
  assertEquals(transformParameters("WHERE a = :a AND b = :b", { a: 1, b: 2 }, array = []), "WHERE a = ? AND b = ?");
  assertEquals(array, [1, 2]);

  // Multiple uses of one valriable
  assertEquals(transformParameters("WHERE a = :a AND b = :b AND c BETWEEN :a AND :b", { a: 1, b: 2 }, array = []), "WHERE a = ? AND b = ? AND c BETWEEN ? AND ?");
  assertEquals(array, [1, 2, 1, 2]);

  // Missing parameter(s)
  assertEquals(transformParameters("WHERE a = :a AND b = :b", { a: 1 }, array = [], true), "WHERE a = ? AND b = ?");
  assertEquals(array, [1, undefined]);
  assertThrows(() => transformParameters("WHERE a = :a AND b = :b", { a: 1 }, array = [], false), Error);

  // Too many parameter(s)
  assertEquals(transformParameters("WHERE a = :a AND b = :b", { a: 1, b: 2, c: 3 }, array = []), "WHERE a = ? AND b = ?");
  assertEquals(array, [1, 2]);
});
