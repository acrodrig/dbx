import { assert } from "./deps.ts";
import { Schema } from "../src/types.ts";
import DB from "../src/db.ts";
import AccountModel from "../resources/account.ts";
import AccountSchema from "../resources/account.json" assert { type: "json" };
import { dbInit } from "./helpers.ts";


const test = Deno.test;
const options = { sanitizeResources: false, sanitizeOps: false };

const TEST_PROVIDER = (Deno.env.get("TEST_PROVIDER") || "mysql").toLowerCase();
const NAME = "Testing Account for QA Team";

await dbInit(TEST_PROVIDER, [ AccountSchema as Schema ]);

let id = -1;

const repo = await DB.getRepository(AccountModel);

// test("DB should be empty", options, async function() {
//     const accounts = await repo.find({ where: { name: NAME } });
//     assert.equal(accounts.length, 0);
// });

test("Basic entity store/retrieve", options, async function() {
    let account = new AccountModel({ name: NAME });

    // Save
    account = await repo.insert(account);
    id = account.id!;
    assert.exists(id);
    assert.equal(account.country, "US");

    // Retrieve by ID
    account = await repo.findById(id) as AccountModel;
    assert.exists(account);

    // // Make sure JSON is retrieved correctly
    assert.deepEqual(account.preferences, { wrap: true, minAge: 18 });
});

test("Retrieve via generic find", options, async function() {
    const account = await repo.find({ where: { id } });
    assert.equal(account.length, 1);
});

test("Retrieve via another column", options, async function() {
    const account = await repo.findOne({ where: { name: NAME } }) as AccountModel;
    assert.exists(account);
});

test("Retrieve via SQL query", options, async function() {
    const records = await DB.query(`SELECT * FROM Account WHERE name = ?`, [NAME]);
    const accounts = records.map(r => new AccountModel(r as unknown as AccountModel));
    assert.equal(accounts.length, 1);
    assert.equal(accounts[0].name, NAME);
});

test("Full Text search", options, async function() {
    const accounts = await repo.find({ where: { name: { match: "Team" } } });
    assert.equal(accounts.length, 1);
});

test("Query with raw SQL", options, async function() {
    const accounts = await repo.find({ where: { or: [ { name: "XYZ" }, { $sql: "(id BETWEEN -1000 AND 1000)" }] } }, true);
    assert.equal(accounts.length, 1);
});

test("Find by ID and update", options, async function() {
    const comments = "Updating comment!";

    // Original account has no comment
    let account = await repo.findById(id) as AccountModel;
    assert.equal(account.comments, undefined);

    // Updated account has the right values
    account.comments = comments;
    account = await repo.update(account) as AccountModel;
    assert.equal(account.id, id);
    assert.equal(account.comments, comments);

    // Retrieved account also
    account = await repo.findById(id) as AccountModel;
    assert.equal(account.comments, comments);
});

test("Clean", options, async function() {
    const ok = await repo.deleteById(id);
    assert.isTrue(ok);
});
