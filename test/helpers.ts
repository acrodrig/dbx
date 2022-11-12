import { DB } from "../src/db.ts";
import { Schema } from "../src/types.ts";

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
    await DB.createTable(schema, DB.type, true);
  }
}

export const getProvider = function () {
  const provider = Deno.env.get("TEST_PROVIDER") ?? Deno.args[0];
  if (!provider) console.warn("\n⚠️  Assuming SQLITE provider. You can use 'TEST_PROVIDER=<provider>' or '-- <provider>' (mysql, postgres, sqlite)\n");
  if (provider && !Object.values(DB.Provider).includes(provider as any)) console.error("\n❌ DB provider '" + provider + "' does not exist!\n");
  return (provider || "sqlite").toLowerCase();
};
