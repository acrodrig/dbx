import { getLogger } from "./deps.ts";
import { Class, Identifiable, Parameter, Row, Schema } from "./types.ts";
import { Repository } from "./repository.ts";
import { DDL } from "./ddl.ts";

// See https://github.com/eveningkid/denodb/blob/master/deps.ts
import { Client as MySQLClient, configLogger } from "https://deno.land/x/mysql@v2.10.2/mod.ts";
import { DB as SQLiteClient, QueryParameterSet } from "https://deno.land/x/sqlite@v3.4.0/mod.ts";
import { Pool as PostgresClient } from "https://deno.land/x/postgres@v0.16.1/mod.ts";


const logger = getLogger("dbx:db");

// Syntactic Sugar
function clean(sql: string) {
    return DB._sqlFilter(sql).replaceAll(/[ \n\r\t]+/g, " ").trim();
}

const Hook = {
    AFTER_DELETE: "after-delete",
    AFTER_INSERT: "after-insert",
    AFTER_UPDATE: "after-update",
    BEFORE_DELETE: "before-delete",
    BEFORE_INSERT: "before-insert",
    BEFORE_UPDATE: "before-update",
} as const;

export interface Client {
    type: string;
    close(): Promise<void>;
    execute(sql: string, parameters?: Parameter[]): Promise<{ affectedRows?: number, lastInsertId?: number }>;
    query(sql: string, parameters?: Parameter[]): Promise<Row[]>;
}

export interface ClientConfig {
    type: string;

    charset?: string;
    database?: string;
    debug?: boolean;
    hostname?: string;
    idleTimeout?: number;
    password?: string;
    poolSize?: number;
    port?: number;
    socketPath?: string;
    username?: string;
    timeout?: number;
}

async function connect(config: ClientConfig): Promise<Client> {
    if (config.type === "mysql") {
        if (!config.debug) await configLogger({ enable: false });
        config = Object.assign(config, { db: config.database });
        const nativeClient = await new MySQLClient().connect(config);
        return new class implements Client {
            type = "mysql";
            close() {
                return nativeClient.close();
            }
            execute(sql: string, parameters?: Parameter[]) {
                return nativeClient.execute(sql, parameters);
            }
            query(sql: string, parameters?: Parameter[]) {
                return nativeClient.query(sql, parameters);
            }
        }
    }
    if (config.type === "postgres") {
        config = Object.assign(config, { user: config.username });
        const nativeClient = await new PostgresClient(config, config.poolSize ?? 1).connect();
        return new class implements Client {
            type = "postgres";
            close() {
                return Promise.resolve();
            }
            async execute(sql: string, parameters?: Parameter[]) {
                const qar = await nativeClient.queryArray(sql, parameters);
                return { affectedRows: qar.rowCount, lastInsertId: qar.rows[0]?.[0] as number ?? undefined };
            }
            async query(sql: string, parameters?: Parameter[]) {
                const qor = await nativeClient.queryObject(sql, parameters);
                return qor.rows as Row[];
            }
        }
    }
    if (config.type === "sqlite") {
        const nativeClient = new SQLiteClient(config.database ?? Deno.env.get("DB_FILE") ?? ":memory:");
        return new class implements Client {
            type = "sqlite";
            close() {
                nativeClient.close();
                return Promise.resolve();
            }
            execute(sql: string, parameters?: Parameter[]) {
                nativeClient.query(sql, parameters as QueryParameterSet);
                return Promise.resolve({ affectedRows: nativeClient.changes, lastInsertId: nativeClient.lastInsertRowId });
            }
            query(sql: string, parameters?: Parameter[]) {
                return Promise.resolve(nativeClient.queryEntries(sql, parameters as QueryParameterSet));
            }
        }
    }
    throw new Error("Unknown Database Type '"+config.type+"'");
}

export class DB {

    static Hook = Hook;
    static readonly ALL = Number.MAX_SAFE_INTEGER;
    static clientConfig: ClientConfig;
    static client: Client;
    static schemas = new Map<string,Schema>();
    static type = "mysql";

    // Mainly for debugging/tests (useful for SQLite)
    static _sqlFilter = function(sql: string): string {
        return sql;
    }

    static async connect(config: ClientConfig, schemas?: Schema[]): Promise<Client> {
        schemas?.forEach(s => DB.schemas.set(s.name, s));
        if (DB.client) return Promise.resolve(DB.client);
        DB.type = config.type;
        return DB.client = await connect(config);
    }

    static async disconnect(): Promise<void> {
        await this.client.close();
    }

    // Transforms parameters (and SQL) into array-like and references via `?`
    static _transformParameters(sql: string, objectParameters: { [key: string]: unknown }, arrayParameters: unknown[]): string {
        arrayParameters.splice(0, arrayParameters.length);
        return sql.replace(/[:][$A-Z_][0-9A-Z_$]*/ig, function(name) {
            arrayParameters.push(objectParameters[name.substring(1)] ?? undefined);
            return "?";
        });
    }

    static _transformPlaceholders(sql: string): string {
        let counter = 0;
        sql = sql.replace(/ *ORDER BY NULL *\n/g, "");
        sql = sql.replace(/\?/g, (_p) => "$"+(++counter));
        return sql;
    }

    static query(sql: string, parameters?: Parameter[] | { [key: string]: Parameter }, debug = false): Promise<Row[]> {
        // If values are not an array, they need to be transformed (as well as the SQL)
        const arrayParameters: Parameter[] = [];
        if (parameters && !Array.isArray(parameters)) {
            sql = DB._transformParameters(sql, parameters, arrayParameters);
            parameters = arrayParameters;
        }
        if (DB.type === "postgres") sql = DB._transformPlaceholders(sql);

        logger.debug({ method: "query", sql: clean(sql), parameters });
        if (debug) console.debug({ method: "query", sql: clean(sql), parameters });

        // At this point SQL contains only `?` and the parameters is an array
        return DB.client.query(DB._sqlFilter(sql), parameters);
    }

    static execute(sql: string, parameters?: Parameter[] | { [key: string]: Parameter }, debug = false) {
        // If values are not an array, they need to be transformed (as well as the SQL)
        const arrayParameters: Parameter[] = [];
        if (parameters && !Array.isArray(parameters)) {
            sql = DB._transformParameters(sql, parameters, arrayParameters);
            parameters = arrayParameters;
        }
        if (DB.type === "postgres") sql = DB._transformPlaceholders(sql);

        logger.debug({ method: "execute", sql: clean(sql), parameters });
        if (debug) console.debug({ method: "execute", sql: clean(sql), parameters });

        // At this point SQL contains only `?` and the parameters is an array
        return DB.client.execute(DB._sqlFilter(sql), parameters);
    }

    // Uses the most standard MySQL syntax and then it is fixed afterwards
    static createTable(schema: Schema, type: string, execute?: false, nameOverride?: string): string;
    static createTable(schema: Schema, type: string, execute?: true, nameOverride?: string): Promise<boolean>;
    static createTable(schema: Schema, type = "mysql", execute = false, nameOverride?: string): string | Promise<boolean> {
        const sql = DDL.createTable(schema, type, nameOverride);

        // Execute?
        if (!execute) return sql;

        // Execute command and return OK
        return DB.execute(sql) as Promise<boolean>;
    }

    static getRepository(tableName: string): Repository<any>;
    static getRepository<T extends Identifiable>(target: Class<T>): Repository<T>;
    static getRepository<T extends Identifiable>(target: string | Class<T>, schema?: Schema): Repository<T> {
        if (typeof(target) !== "string") return new Repository(target, schema ?? DB.schemas.get(target.name));
        return new Repository(Object as unknown as Class<T>, undefined, target);
    }
}

type LocalClientConfig = ClientConfig;
type LocalSchema = Schema;

// deno-lint-ignore no-namespace
export namespace DB {
    export type ClientConfig = LocalClientConfig;
    export type Schema = LocalSchema;
}

export default DB;
