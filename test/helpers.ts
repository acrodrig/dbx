import { DB } from "../src/db.ts";
import { DDL } from "../src/ddl.ts";
import { Schemas } from "../src/schemas.ts";
import type { Schema } from "../src/types.ts";

const PROVIDER = Deno.env.get("TEST_PROVIDER") ?? Deno.args[0];
if (!PROVIDER) console.warn("\n⚠️  Assuming SQLITE provider. You can use 'TEST_PROVIDER=<provider>' or '-- <provider>' (mysql, postgres, sqlite)\n");

// Make sure loggers

export async function dbInit(type: string, schemas?: Schema[]) {
  // If it is SQLite, it will do an in-memory DB
  const hostname = "127.0.0.1";
  const sqlite = type === DB.Provider.SQLITE;
  const database = sqlite ? ":memory:" : "dbx";

  try {
    await DB.connect({ type, hostname, database, username: "dbx" }, schemas);
    if (sqlite) await dbExec(Deno.readTextFileSync(import.meta.dirname + "/helpers.sql"));
    if (schemas) await createTables(schemas);
  } catch (ex) {
    console.error("\n❌ Could not connect to DB '" + type + "' using 'dbx@" + hostname + "' or could not execute SQL!\n");
    console.error("MESSAGE: " + (ex as Error).message + "", ex);
    console.error("\nMake sure the user is created in the database (with NO password) and the DB is up\n");
    Deno.exit(1);
  }

  return DB;
}

export async function dbExec(sql: string) {
  for (const expr of sql.split(";")) {
    if (expr.trim().length === 0) continue;
    await DB.execute(expr, undefined);
  }
}

export async function createTables(schemas: Schema[]) {
  for (const schema of schemas) {
    if (DB.type !== DB.Provider.SQLITE) await DB.execute(`DROP TABLE IF EXISTS ${schema.table} CASCADE;`);
    const sql = DDL.createTable(schema, DB.type as DB.Provider);
    await dbExec(sql);
  }
}

export const getProvider = function (): DB.Provider {
  const provider = PROVIDER?.toLowerCase() as DB.Provider;
  if (provider && !Object.values(DB.Provider).includes(provider)) {
    console.error("\n❌ DB provider '" + provider + "' does not exist!\n");
    Deno.exit(1);
  }
  return provider || DB.Provider.SQLITE;
};

// Generator function is declared here so that it does not go into the published module
export async function generator(classFiles: Record<string, string>, base?: string) {
  const TJS = (await import("npm:typescript-json-schema@0.65.1")).default;
  const program = TJS.getProgramFromFiles(Object.values(classFiles), Schemas.TS_OPTIONS, base);
  // deno-lint-ignore no-explicit-any
  const entries = Object.keys(classFiles).map((c) => [c, TJS.generateSchema(program, c, Schemas.TJS_OPTIONS as any)]);
  return Object.fromEntries(entries);
}
