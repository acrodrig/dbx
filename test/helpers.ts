import { getLogger, handlers, LogLevels } from "std/log/mod.ts";
import { DB } from "../src/db.ts";
import { DDL } from "../src/ddl.ts";
import { Schema } from "../src/types.ts";

// Make SURE we print errors during the test
const CONSOLE = new handlers.ConsoleHandler("DEBUG");

for (const name of ["db", "repository"]) {
  const logger = getLogger("dbx:" + name);
  logger.level = LogLevels.INFO;
  logger.handlers.push(CONSOLE);
}

export const sleep = function (time: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, time));
};

export async function dbInit(type: string, schemas: Schema[]) {
  // If it is SQLite it will do an in-memory DB
  await DB.connect({ type, database: type === "sqlite" ? ":memory:" : "dbx", username: "dbx" }, schemas);
  await createTables(schemas);
}

export async function createTables(schemas: Schema[]) {
  for (const schema of schemas) {
    const sql = DDL.createTable(schema, DB.type);
    await DB.execute(sql);
  }
}

export const getProvider = function () {
  const provider = Deno.env.get("TEST_PROVIDER") ?? Deno.args[0];
  if (!provider) console.warn("\n⚠️  Assuming SQLITE provider. You can use 'TEST_PROVIDER=<provider>' or '-- <provider>' (mysql, postgres, sqlite)\n");
  if (provider && !Object.values(DB.Provider).includes(provider as any)) console.error("\n❌ DB provider '" + provider + "' does not exist!\n");
  return (provider || "sqlite").toLowerCase();
};
