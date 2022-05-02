import { assert } from "./deps.ts";
import { Repository } from "../src/repository.ts";
import DB from "../src/db.ts";


const test = Deno.test;

test("Test _where (with META ?? placeholder)", function () {
    const where = Repository._where, now = new Date(), meta = true;
    let tree: unknown[];
    assert.equal(where({ a: 1, b: 2 }, tree = [], meta), "?? = ? AND ?? = ?");
    assert.deepEqual(tree, ["a", 1, "b", 2]);
    assert.equal(where({ a: null, c: { gt: 3 }, or: [{ x: "X" }, { d: { lte: now }}] }, tree = [], meta), "?? IS ? AND ?? > ? AND (?? = ? OR ?? <= ?)");
    assert.deepEqual(tree, ["a", null, "c", 3, "x", "X", "d",now]);
});

test("Test _where (with NO META ??)", function () {
    const where = Repository._where, now = new Date(), meta = false;
    let tree: unknown[];
    assert.equal(where({ a: 1, b: 2 }, tree = [], meta), "a = ? AND b = ?");
    assert.deepEqual(tree, [1, 2]);
    assert.equal(where({ a: null, c: { gt: 3 }, or: [{ x: "X" }, { d: { lte: now }}] }, tree = [], meta), "a IS ? AND c > ? AND (x = ? OR d <= ?)");
    assert.deepEqual(tree, [null, 3, "X", now]);
});

test("Test _transformParameters", function () {
    const transformParameters = DB._transformParameters;
    let array: unknown[];

    // Simple one to one
    assert.equal(transformParameters("WHERE a = :a AND b = :b", { a: 1, b: 2 }, array = []), "WHERE a = ? AND b = ?");
    assert.deepEqual(array, [1, 2]);

    // Multiple uses of one valriable
    assert.equal(transformParameters("WHERE a = :a AND b = :b AND c BETWEEN :a AND :b", { a: 1, b: 2 }, array = []), "WHERE a = ? AND b = ? AND c BETWEEN ? AND ?");
    assert.deepEqual(array, [1, 2, 1, 2]);

    // Missing parameter(s)
    assert.equal(transformParameters("WHERE a = :a AND b = :b", { a: 1 }, array = []), "WHERE a = ? AND b = ?");
    assert.deepEqual(array, [1, undefined]);

    // Too many parameter(s)
    assert.equal(transformParameters("WHERE a = :a AND b = :b", { a: 1, b: 2, c: 3 }, array = []), "WHERE a = ? AND b = ?");
    assert.deepEqual(array, [1, 2]);
});
