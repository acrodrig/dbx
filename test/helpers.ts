import { handlers, setup } from "std/log/mod.ts";
import { DB } from "../src/db.ts";
import { DDL } from "../src/ddl.ts";
import { Schema } from "../src/types.ts";

setup({
  handlers: { console: new handlers.ConsoleHandler("DEBUG") },
  loggers: { dbx: { level: "INFO", handlers: ["console"] } },
});

export async function dbInit(type: string, schemas: Schema[]) {
  // If it is SQLite, it will do an in-memory DB
  const hostname = "127.0.0.1";
  const port = parseInt(Deno.env.get("TEST_PORT") ?? "3306");
  const database = type === "sqlite" ? ":memory:" : "dbx";
  try {
    await DB.connect({ type, hostname, database, username: "dbx", port }, schemas);
    await createTables(schemas);
  } catch (ex) {
    console.error("\n❌ Could not connect to DB '" + type + "' using 'dbx@" + hostname + ":" + port + "'!");
    console.error("ERROR MESSAGE: " + ex.message + "");
    console.error("\nMake sure the user is created in the database (with NO password) and the DB is up\n");
    Deno.exit(1);
  }
}

export async function dbExec(sql: string) {
  for (const expr of sql.split(";")) {
    if (expr.trim().length === 0) continue;
    await DB.execute(expr);
  }
}

export async function createTables(schemas: Schema[]) {
  for (const schema of schemas) {
    const sql = DDL.createTable(schema, DB.type);
    await DB.execute(sql);
  }
}

export const getProvider = function () {
  const provider = (Deno.env.get("TEST_PROVIDER") ?? Deno.args[0]) as DB.Provider;
  if (!provider) console.warn("\n⚠️  Assuming SQLITE provider. You can use 'TEST_PROVIDER=<provider>' or '-- <provider>' (mysql, postgres, sqlite)\n");
  if (provider && !Object.values(DB.Provider).includes(provider)) {
    console.error("\n❌ DB provider '" + provider + "' does not exist!\n");
    Deno.exit(1);
  }
  return (provider || "sqlite").toLowerCase();
};
