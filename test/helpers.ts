import { DB } from "../src/db.ts";
import { Schema } from "../src/types.ts";


export const sleep = function(time: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, time));
};

export async function dbInit(type: string, schemas: Schema[]) {
    // If it is SQLite it will do an in-memory DB
    await DB.connect( { type, database: type === "sqlite" ? ":memory:" : "dbx", username: "dbx" }, schemas);
    await createTables(schemas);
}

export async function createTables(schemas: Schema[]) {
    for (const schema of schemas) {
        await DB.createTable(schema, DB.type, true);
    }
}
