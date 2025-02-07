import { blue, bold, white } from "@std/fmt/colors";
import { ConsoleHandler, getLogger, type LevelName, type Logger } from "@std/log";
import { DDL } from "./ddl.ts";
import type { Class, Identifiable, Parameter, Row, Schema } from "./types.ts";
import { Repository } from "./repository.ts";

const TTY = Deno.stderr.isTerminal();

// See https://stackoverflow.com/questions/49285864/is-there-a-valueof-similar-to-keyof-in-typescript
type Values<T> = T[keyof T];

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

const Provider = {
  MYSQL: "mysql",
  MYSQL2: "mysql2",
  POSTGRES: "postgres",
  SQLITE: "sqlite",
} as const;
type Provider = Values<typeof Provider>;

export interface Client {
  type: string;
  close(): Promise<void>;
  execute(sql: string, parameters?: Parameter[], debug?: boolean): Promise<{ affectedRows?: number; lastInsertId?: number }>;
  query(sql: string, parameters?: Parameter[], debug?: boolean): Promise<Row[]>;
}

export interface ClientConfig {
  type: string;
  cache?: number;
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
  // Set the debug flag
  DB.debug = Deno.env.get("DEBUG")?.includes("dbx") || config.debug || false;

  // MySQL
  if (config.type === Provider.MYSQL) {
    const mysql = await import("https://deno.land/x/mysql@v2.12.1/mod.ts");
    if (!config.debug) await mysql.configLogger({ enable: false });
    config = Object.assign(config, { db: config.database });
    if (!config.charset) config.charset = "utf8mb4";
    const nativeClient = await new mysql.Client().connect(config);
    return new class implements Client {
      type = config.type;
      close() {
        return nativeClient.close();
      }
      execute(sql: string, parameters?: Parameter[]) {
        return nativeClient.execute(sql, parameters);
      }
      query(sql: string, parameters?: Parameter[]) {
        return nativeClient.query(sql, parameters);
      }
    }();
  }

  // MySQL2
  if (config.type === Provider.MYSQL2) {
    const mysql2 = await import("npm:mysql2@^3.11/promise");
    const nativeClient = await mysql2.createConnection({
      host: config.hostname ?? "127.0.0.1",
      database: config.database,
      user: config.username,
      password: config.password,
      charset: "utf8mb4",
    });
    return new class implements Client {
      type = config.type;
      close() {
        // TODO
        return Promise.resolve();
      }
      async execute(sql: string, parameters?: Parameter[]) {
        // deno-lint-ignore no-explicit-any
        const [rsh] = await (nativeClient as any).execute(sql, parameters);
        // deno-lint-ignore no-explicit-any
        return { affectedRows: (rsh as any).affectedRows, lastInsertId: (rsh as any).insertId };
      }
      async query(sql: string, parameters?: Parameter[]) {
        // deno-lint-ignore no-explicit-any
        const [rows] = await (nativeClient as any).query(sql, parameters);
        return rows as Row[];
      }
    }();
  }

  // Postgres
  if (config.type === Provider.POSTGRES) {
    const postgres = await import("https://deno.land/x/postgres@v0.19.3/mod.ts");
    config = Object.assign(config, { user: config.username });
    const nativeClient = await new postgres.Pool(config, config.poolSize ?? 1).connect();
    return new class implements Client {
      type = config.type;
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
    }();
  }

  // Sqlite
  if (config.type === Provider.SQLITE) {
    const sqlite = await import("https://deno.land/x/sqlite@v3.9.1/mod.ts");
    const nativeClient = new sqlite.DB(config.database ?? Deno.env.get("DB_FILE") ?? ":memory:");
    return new class implements Client {
      type = config.type;
      close() {
        nativeClient.close();
        return Promise.resolve();
      }
      execute(sql: string, parameters?: Parameter[]) {
        // deno-lint-ignore no-explicit-any
        nativeClient.query(sql, parameters as any);
        return Promise.resolve({ affectedRows: nativeClient.changes, lastInsertId: nativeClient.lastInsertRowId });
      }
      query(sql: string, parameters?: Parameter[]) {
        // deno-lint-ignore no-explicit-any
        return Promise.resolve(nativeClient.queryEntries(sql, parameters as any));
      }
    }();
  }
  throw new Error("Unknown Database Type '" + config.type + "'");
}

export class DB {
  static DEFAULT_CAPACITY = 1000;
  static Hook = Hook;
  static Provider = Provider;
  static readonly ALL = Number.MAX_SAFE_INTEGER;
  static client: Client;
  static debug = false;
  static #schemas = new Map<string, Schema>();
  static type: string;
  static capacity = this.DEFAULT_CAPACITY;

  static get logger(): Logger {
    return this.mainLogger();
  }

  // Get parent logger and if the logger has not been set, it will add a handler and level
  static mainLogger(level: LevelName = "INFO"): Logger {
    const logger = getLogger("gateways");
    if (logger.handlers.length === 0) logger.handlers.push(new ConsoleHandler("DEBUG"));
    const debug = Deno.env.get("DEBUG")?.includes(logger.loggerName) || this.debug;
    if (debug) logger.levelName = "DEBUG";
    if (logger.levelName !== level) logger.levelName = level;
    return logger;
  }

  // Mainly for debugging/tests (useful for SQLite)
  static _sqlFilter = function (sql: string): string {
    return sql.replaceAll(" ORDER BY NULL", "");
  };

  static async connect(config: ClientConfig, schemas?: Schema[]): Promise<Client> {
    // By default, we add a cache
    this.capacity = config.cache === undefined ? this.DEFAULT_CAPACITY : config.cache;

    // Iterate over the schemas and map them by name and type if it exists
    schemas?.forEach((s) => {
      DB.#schemas.set(s.name, s);
      if (s.type) DB.#schemas.set(s.type, s);
    });
    if (DB.client) return Promise.resolve(DB.client);
    DB.type = config.type;
    DB.client = await connect(config);

    // Should wrap in debugger?
    if (this.debug) DB.client = new DebugClient(DB.client);

    return DB.client;
  }

  static async disconnect(): Promise<void> {
    await this.client.close();
  }

  // Transforms parameters (and SQL) into array-like and references via `?`
  static _transformParameters(sql: string, objectParameters: { [key: string]: unknown }, arrayParameters: unknown[], safe?: boolean): string {
    arrayParameters.splice(0, arrayParameters.length);
    return sql.replace(/:[$A-Z_][0-9A-Z_$]*/ig, function (name) {
      const value = objectParameters[name.substring(1)];
      if (value === undefined && !safe) throw new Error("Undefined parameter '" + name + "'");
      const isArray = Array.isArray(value);
      // If it is an array we need to repeat N times the '?' and append all the values
      if (isArray) arrayParameters.push(...value);
      else arrayParameters.push(value);
      return isArray ? value.map((_) => "?").join(",") : "?";
    });
  }

  static _transformPlaceholders(sql: string): string {
    let counter = 0;
    sql = sql.replace(/ *ORDER BY NULL *\n/g, "");
    sql = sql.replace(/\?/g, (_p) => "$" + (++counter));
    return sql;
  }

  static async query(sql: string, parameters?: Parameter[] | { [key: string]: Parameter }, debug?: boolean): Promise<Row[]> {
    // If values are not an array, they need to be transformed (as well as the SQL)
    const arrayParameters: Parameter[] = [];
    if (parameters && !Array.isArray(parameters)) {
      sql = DB._transformParameters(sql, parameters, arrayParameters);
      parameters = arrayParameters;
    }
    if (DB.type === Provider.POSTGRES) sql = DB._transformPlaceholders(sql);

    if (debug !== false) this.logger.debug({ method: "query", sql: clean(sql), parameters });
    if (debug) console.debug({ method: "query", sql: clean(sql), parameters });

    // At this point SQL contains only `?` and the parameters is an array
    try {
      // Need to await to be able to catch potential errors
      return await DB.client.query(DB._sqlFilter(sql), parameters, debug);
    } catch (ex) {
      if (TTY) DB.error(ex as Error, sql, parameters);
      this.logger.error({ method: "query", sql: clean(sql), parameters, error: (ex as Error).message, stack: (ex as Error).stack });
      throw ex;
    }
  }

  static execute(sql: string, parameters?: Parameter[] | { [key: string]: Parameter }, debug?: boolean): Promise<{ affectedRows?: number; lastInsertId?: number }> {
    // If values are not an array, they need to be transformed (as well as the SQL)
    const arrayParameters: Parameter[] = [];
    if (parameters && !Array.isArray(parameters)) {
      sql = DB._transformParameters(sql, parameters, arrayParameters);
      parameters = arrayParameters;
    }
    if (DB.type === Provider.POSTGRES) sql = DB._transformPlaceholders(sql);

    if (debug !== false) this.logger.debug({ method: "execute", sql: clean(sql), parameters });
    if (debug) console.debug({ method: "execute", sql: clean(sql), parameters });

    // At this point SQL contains only `?` and the parameters is an array
    try {
      // Need to await to be able to catch potential errors
      return DB.client.execute(DB._sqlFilter(sql), parameters, debug);
    } catch (ex) {
      if (TTY) DB.error(ex as Error, sql, parameters);
      this.logger.error({ method: "execute", sql: clean(sql), parameters, error: (ex as Error).message, stack: (ex as Error).stack });
      throw ex;
    }
  }

  // Uses the most standard MySQL syntax, modifies for other DBs inflight
  static createTable(schema: Schema, type: DB.Provider, execute: false, nameOverride?: string): Promise<string>;
  static createTable(schema: Schema, type: DB.Provider, execute: true, nameOverride?: string): Promise<boolean>;
  static async createTable(schema: Schema, type: DB.Provider, execute = true, nameOverride?: string): Promise<string | boolean> {
    const sql = DDL.createTable(schema, type, nameOverride);
    if (!execute) return Promise.resolve(sql);
    await DB.execute(sql);
    return true;
  }

  // Repository cache
  static #repositories = new Map<string | Class<Identifiable>, Repository<Identifiable>>();

  // deno-lint-ignore no-explicit-any
  static getRepository(tableName: string): Repository<any>;
  static getRepository<T extends Identifiable>(target: Class<T>): Repository<T>;
  static getRepository<T extends Identifiable>(target: string | Class<T>, schema?: Schema): Repository<T> {
    let repository = this.#repositories.get(target) as Repository<T>;
    if (repository) return repository;

    // Figure out target, schema and name
    const name = typeof target === "string" ? target : target.name;
    if (typeof target === "string") target = Object as unknown as Class<T>;
    if (!schema) schema = DB.#schemas.get(name);
    repository = new Repository(target, schema, schema?.name ?? name, this.capacity);
    this.#repositories.set(target, repository as Repository<Identifiable>);

    // Return repository
    return repository;
  }

  static error(ex: Error, sql: string, parameters?: Parameter[]) {
    console.error("%cERROR: %s", "color: red", ex?.message);
    console.error("---");
    console.error(clean(sql));
    console.error("---");
    console.error(parameters);
  }
}

// Debug Client
// deno-fmt-ignore
const RESERVED = ["ACCESSIBLE","ADD","ALL","ALTER","ANALYZE","AND","AS","ASC","ASENSITIVE","BEFORE","BETWEEN","BIGINT","BINARY","BLOB","BOTH","BY","CALL","CASCADE","CASE","CHANGE","CHAR","CHARACTER","CHECK","COLLATE","COLUMN","CONDITION","CONSTRAINT","CONTINUE","CONVERT","CREATE","CROSS","CUBE","CUME_DIST","CURRENT_DATE","CURRENT_TIME","CURRENT_TIMESTAMP","CURRENT_USER","CURSOR","DATABASE","DATABASES","DAY_HOUR","DAY_MICROSECOND","DAY_MINUTE","DAY_SECOND","DEC","DECIMAL","DECLARE","DEFAULT","DELAYED","DELETE","DENSE_RANK","DESC","DESCRIBE","DETERMINISTIC","DISTINCT","DISTINCTROW","DIV","DOUBLE","DROP","DUAL","EACH","ELSE","ELSEIF","EMPTY","ENCLOSED","ESCAPED","EXCEPT","EXISTS","EXIT","EXPLAIN","FALSE","FETCH","FIRST_VALUE","FLOAT","FLOAT4","FLOAT8","FOR","FORCE","FOREIGN","FROM","FULLTEXT","FUNCTION","GENERATED","GET","GRANT","GROUP","GROUPING","GROUPS","HAVING","HIGH_PRIORITY","HOUR_MICROSECOND","HOUR_MINUTE","HOUR_SECOND","IF","IGNORE","IN","INDEX","INFILE","INNER","INOUT","INSENSITIVE","INSERT","INT","INT1","INT2","INT3","INT4","INT8","INTEGER","INTERSECT","INTERVAL","INTO","IO_AFTER_GTIDS","IO_BEFORE_GTIDS","IS","ITERATE","JOIN","JSON_TABLE","KEY","KEYS","KILL","LAG","LAST_VALUE","LATERAL","LEAD","LEADING","LEAVE","LEFT","LIKE","LIMIT","LINEAR","LINES","LOAD","LOCALTIME","LOCALTIMESTAMP","LOCK","LONG","LONGBLOB","LONGTEXT","LOOP","LOW_PRIORITY","MASTER_BIND","MASTER_SSL_VERIFY_SERVER_CERT","MATCH","MAXVALUE","MEDIUMBLOB","MEDIUMINT","MEDIUMTEXT","MIDDLEINT","MINUTE_MICROSECOND","MINUTE_SECOND","MOD","MODIFIES","NATURAL","NOT","NO_WRITE_TO_BINLOG","NTH_VALUE","NTILE","NULL","NUMERIC","OF","ON","OPTIMIZE","OPTIMIZER_COSTS","OPTION","OPTIONALLY","OR","ORDER","OUT","OUTER","OUTFILE","OVER","PARTITION","PERCENT_RANK","PRECISION","PRIMARY","PROCEDURE","PURGE","RANGE","RANK","READ","READS","READ_WRITE","REAL","RECURSIVE","REFERENCES","REGEXP","RELEASE","RENAME","REPEAT","REPLACE","REQUIRE","RESIGNAL","RESTRICT","RETURN","REVOKE","RIGHT","RLIKE","ROW","ROWS","ROW_NUMBER","SCHEMA","SCHEMAS","SECOND_MICROSECOND","SELECT","SENSITIVE","SEPARATOR","SET","SHOW","SIGNAL","SMALLINT","SPATIAL","SPECIFIC","SQL","SQLEXCEPTION","SQLSTATE","SQLWARNING","SQL_BIG_RESULT","SQL_CALC_FOUND_ROWS","SQL_SMALL_RESULT","SSL","STARTING","STORED","STRAIGHT_JOIN","SYSTEM","TABLE","TERMINATED","THEN","TINYBLOB","TINYINT","TINYTEXT","TO","TRAILING","TRIGGER","TRUE","UNDO","UNION","UNIQUE","UNLOCK","UNSIGNED","UPDATE","USAGE","USE","USING","UTC_DATE","UTC_TIME","UTC_TIMESTAMP","VALUES","VARBINARY","VARCHAR","VARCHARACTER","VARYING","VIRTUAL","WHEN","WHERE","WHILE","WINDOW","WITH","WRITE","XOR","YEAR_MONTH","ZEROFILL"];

class DebugClient implements Client {
  type: string;
  reserved: RegExp;
  constructor(private client: Client) {
    this.type = client.type;
    this.reserved = new RegExp("\\b(" + RESERVED.join("|") + ")\\b", "g");
  }
  close(): Promise<void> {
    return this.client.close();
  }
  async execute(sql: string, parameters?: Parameter[], debug?: boolean): Promise<{ affectedRows?: number; lastInsertId?: number }> {
    const start = Date.now();
    const result = await this.client.execute(sql, parameters);
    if (debug !== false) this.debug(sql, parameters ?? [], result.affectedRows ?? 0, start);
    return result;
  }
  async query(sql: string, parameters?: Parameter[], debug?: boolean): Promise<Row[]> {
    const start = Date.now();
    const result = await this.client.query(sql, parameters);
    if (debug !== false) this.debug(sql, parameters ?? [], result.length ?? 0, start);
    return result;
  }
  debug(sql: string, parameters: Parameter[], rows: number, start: number, indent = "", pad = 20) {
    // If the flag is ON will debug to console
    const time = "(" + rows + " row" + (rows === 1 ? "" : "s") + " in " + (Date.now() - start) + "ms)";
    let i = 0;
    sql = sql.replace(/\?/g, () => blue(String(i < parameters.length ? parameters[i++] : "⚠️")));
    sql = sql.replace(this.reserved, (w) => bold(w));
    console.debug(indent + "🛢️ " + white(time.padStart(pad)) + " " + sql.trim());
  }
}

type LocalClientConfig = ClientConfig;
type LocalProvider = Provider;
type LocalSchema = Schema;

// deno-lint-ignore no-namespace
export namespace DB {
  export type ClientConfig = LocalClientConfig;
  export type Provider = LocalProvider;
  export type Schema = LocalSchema;
}

export default DB;
