import { assert, assertEquals, path } from "./deps.ts";
import DB from "../src/db.ts";
import { dbInit } from "./helpers.ts";


const __dirname = path.dirname(path.fromFileUrl(import.meta.url));

const test = Deno.test;
const options = { sanitizeResources: false, sanitizeOps: false };

const TEST_PROVIDER = (Deno.env.get("TEST_PROVIDER") || "sqlite").toLowerCase();

// See https://lucy-kim.github.io/pages/learn-mySQL.html

await dbInit(TEST_PROVIDER, []);

const DATA = Deno.readTextFileSync(__dirname+"/../resources/data.sql");

const repo = await DB.getRepository("EMP");

test("Ensure DB", options, async function() {
    // Does the EMP table exist?
    let dataExists = true;
    try { await DB.query("SELECT AVG(1) FROM Emp"); }
    catch (_ex) { dataExists = false; }

    // If it does not exists, create it
    if (!dataExists) {
        for (const sql of DATA.split(";")) {
            if (sql.trim().length === 0) continue;
            await DB.execute(sql);
        }
    }

    // Postgres needs because it returns a BigInt
    const rows = await DB.query("SELECT 1 FROM Emp");
    assertEquals(rows.length, 14);
});

test("Select all employees", options, async function() {
    const emps = await repo.all();
    assertEquals(emps.length, 14);
});

test("Select employees with salary less than 1000", options, async function() {
    const emps = await repo.find({ where: { sal: { lt: 1000 } } });
    assertEquals(emps.length, 2);
    assert(emps.every(e => e.sal < 1000));
});

test("Query employees with salary more than 1000", options, async function() {
    const emps = await DB.query("SELECT * FROM Emp WHERE sal > :minSal", { minSal: 1000 });
    assertEquals(emps.length, 12);
});
