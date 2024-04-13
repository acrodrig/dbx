import { ConsoleHandler, setup } from "std/log/mod.ts";
import { DB } from "../src/db.ts";
import { DDL } from "../src/ddl.ts";
import { Schema } from "../src/types.ts";

const PROVIDER = Deno.env.get("TEST_PROVIDER") ?? Deno.args[0];
if (!PROVIDER) console.warn("\n⚠️  Assuming SQLITE provider. You can use 'TEST_PROVIDER=<provider>' or '-- <provider>' (mysql, postgres, sqlite)\n");

setup({
  handlers: { console: new ConsoleHandler("DEBUG") },
  loggers: { dbx: { level: "INFO", handlers: ["console"] } },
});

export async function dbInit(type: string, schemas?: Schema[]) {
  // If it is SQLite, it will do an in-memory DB
  const hostname = "127.0.0.1";
  const sqlite = type === DB.Provider.SQLITE;
  const database = sqlite ? ":memory:" : "dbx";

  try {
    await DB.connect({ type, hostname, database, username: "dbx", quiet: true }, schemas);
    if (sqlite) await dbExec(Deno.readTextFileSync(import.meta.dirname+"/helpers.sql"));
    if (schemas) await createTables(schemas);
  } catch (ex) {
    console.error("\n❌ Could not connect to DB '" + type + "' using 'dbx@" + hostname + "' or could not execute SQL!\n");
    console.error("MESSAGE: " + ex.message + "");
    console.error("\nMake sure the user is created in the database (with NO password) and the DB is up\n");
    Deno.exit(1);
  }

  return DB;
}

export async function dbExec(sql: string) {
  for (const expr of sql.split(";")) {
    if (expr.trim().length === 0) continue;
    await DB.execute(expr);
  }
}

export async function createTables(schemas: Schema[]) {
  for (const schema of schemas) {
    if (DB.type !== DB.Provider.SQLITE) await DB.execute(`DROP TABLE IF EXISTS ${schema.name} CASCADE;`);
    const sql = DDL.createTable(schema, DB.type as DB.Provider);
    await dbExec(sql);
  }
}

export const getProvider = function(): DB.Provider {
  const provider = PROVIDER?.toLowerCase() as DB.Provider;
  if (provider && !Object.values(DB.Provider).includes(provider)) {
    console.error("\n❌ DB provider '" + provider + "' does not exist!\n");
    Deno.exit(1);
  }
  return provider || DB.Provider.SQLITE;
};
