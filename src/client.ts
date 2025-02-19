import type { Client, ClientConfig, Parameter, Row } from "./types.ts";

// Import Driver Types
import type { Database as SQLite } from "jsr:@db/sqlite@0";
import type { Client as Postgres } from "jsr:@dewars/postgres@0";

export async function connect(config: ClientConfig): Promise<Client> {
  // Make sure we have a valid configuration
  config = Object.assign({
    hostname: Deno.env.get("DB_HOST") ?? "127.0.0.1",
    port: Number(Deno.env.get("DB_PORT")) || 3306,
    username: Deno.env.get("DB_USER") ?? "primary",
    password: Deno.env.get("DB_PASS"),
  }, config);

  // Cleans parameters of temporal values
  const isTemporal = (p: unknown) => p && ["PlainDate", "PlainDateTime", "PlainTime"].includes(p?.constructor?.name);
  const cleanTemporals = (parameters: Parameter[] | undefined) => parameters?.map((p) => isTemporal(p) ? p!.toString() : p);

  // MySQL
  if (config.type === "mysql") {
    const mysql = await import("npm:mysql2@^3/promise");
    const nativeClient = await mysql.createConnection({
      host: config.hostname ?? "127.0.0.1",
      database: config.database,
      user: config.username,
      password: config.password,
      charset: "utf8mb4",
    });
    return new class implements Client {
      config = config;
      close() {
        return nativeClient.end();
      }
      async execute(sql: string, parameters?: Parameter[]) {
        // deno-lint-ignore no-explicit-any
        const [rsh] = await (nativeClient as any).execute(sql, cleanTemporals(parameters));
        // deno-lint-ignore no-explicit-any
        return { affectedRows: (rsh as any).affectedRows, lastInsertId: (rsh as any).insertId };
      }
      async query(sql: string, parameters?: Parameter[]) {
        // deno-lint-ignore no-explicit-any
        const [rows] = await (nativeClient as any).query(sql, cleanTemporals(parameters));
        return rows as Row[];
      }
    }();
  }

  // Postgres
  if (config.type === "postgres") {
    const postgres = await import("jsr:@dewars/postgres@0");
    config = Object.assign(config, { user: config.username });
    const nativeClient = await new postgres.Pool(config, config.poolSize ?? 1).connect() as Postgres;
    return new class implements Client {
      config = config;
      close() {
        return nativeClient.end();
      }
      async execute(sql: string, parameters?: Parameter[]) {
        const qar = await nativeClient.queryArray(sql, cleanTemporals(parameters));
        return { affectedRows: qar.rowCount, lastInsertId: qar.rows[0]?.[0] as number ?? undefined };
      }
      async query(sql: string, parameters?: Parameter[]) {
        const qor = await nativeClient.queryObject(sql, cleanTemporals(parameters));
        return qor.rows as Row[];
      }
    }();
  }

  // Sqlite
  if (config.type === "sqlite") {
    const sqlite = await import("jsr:@db/sqlite@0");
    const nativeClient = new sqlite.Database(config.database ?? Deno.env.get("DB_FILE") ?? ":memory:") as SQLite;

    // Add regex function
    nativeClient.function("regexp", (str: string, re: string): boolean => new RegExp(re).exec(str) !== null);

    return new class implements Client {
      config = config;
      close() {
        return Promise.resolve(nativeClient.close());
      }
      execute(sql: string, parameters?: Parameter[]) {
        nativeClient.exec(sql, cleanTemporals(parameters));
        return Promise.resolve({ affectedRows: nativeClient.changes, lastInsertId: nativeClient.lastInsertRowId });
      }
      query(sql: string, parameters?: Parameter[]) {
        return Promise.resolve(nativeClient.prepare(sql).all(cleanTemporals(parameters)));
      }
    }();
  }
  throw new Error("Unknown Database Type '" + config.type + "'");
}
