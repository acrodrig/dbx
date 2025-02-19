import { blue, bold, white } from "@std/fmt/colors";
import { hub } from "hub";
import { connect } from "./client.ts";
import { DDL } from "./ddl.ts";
import type { Class, Client, ClientConfig, Identifiable, Parameter, Row, Schema } from "./types.ts";
import { Repository } from "./repository.ts";

const log = hub("dbx"), sqlLog = hub("dbx:sql");

// See https://stackoverflow.com/questions/49285864/is-there-a-valueof-similar-to-keyof-in-typescript
type Values<T> = T[keyof T];

// Syntactic Sugar
function clean(sql: string): string {
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
  POSTGRES: "postgres",
  SQLITE: "sqlite",
} as const;
type Provider = Values<typeof Provider>;

export class DB {
  static Hook = Hook;
  static Provider = Provider;
  static readonly ALL = Number.MAX_SAFE_INTEGER;
  static client: Client;
  static #schemas = new Map<string, Schema>();
  static type: string;

  // Mainly for debugging/tests (useful for SQLite)
  static _sqlFilter = function (sql: string): string {
    return sql.replaceAll(" ORDER BY NULL", "");
  };

  static async connect(config: ClientConfig, schemas: Schema[] | Record<string, Schema> = [], ensure = false): Promise<Client> {
    DB.#schemas.clear();
    // Iterate over the schemas and map them by name and type if it exists
    if (!Array.isArray(schemas)) schemas = Object.values(schemas as Record<string, Schema>);
    schemas.forEach((s) => {
      DB.#schemas.set(s.table!, s);
      if (s.type) DB.#schemas.set(s.type, s);
    });
    if (DB.client) return Promise.resolve(DB.client);
    DB.type = config.type;
    DB.client = await connect(config);

    // Ensure connection?
    if (ensure) await DB.ensure();

    return DB.client;
  }

  static async disconnect(): Promise<void> {
    await this.client.close();
  }

  static async ensure(safe = false): Promise<string | undefined> {
    // Follow JDBC URL format: db://hostname:port/database
    const config = DB.client.config;
    const url = config.type + ":" + config.username + "@" + config.hostname + ":" + config.port + "/" + config.database;

    try {
      const [{ sum }] = await DB.query("SELECT 1+1 AS sum");
      if (sum === 2) return url;
    } catch (ex) {
      const message = "❌ Could not connect to DB '" + url + "', review DB configuration";
      if (!safe) throw new Error(message);
      else log.error(message, ex);
    }
  }

  // Transforms parameters (and SQL) into array-like and references via `?`
  static _transformParameters(sql: string, objectParameters: { [key: string]: unknown }, arrayParameters: unknown[], safe?: boolean): string {
    arrayParameters.splice(0, arrayParameters.length);
    return sql.replace(/:[$A-Z_][0-9A-Z_$]*/ig, function (name) {
      const exists = Object.hasOwn(objectParameters, name.substring(1));
      const value = objectParameters[name.substring(1)];
      if (!exists && !safe) throw new Error("Parameter '" + name + "' is not present in parameters (" + JSON.stringify(objectParameters) + ")");
      if (value === undefined && !safe) throw new Error("Parameter '" + name + "' exists but is undefined in (" + JSON.stringify(objectParameters) + ")");
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

  static _logSql(sql: string, parameters: Parameter[], rows: number, start: number) {
    if (sqlLog.level !== "debug") return;
    const time = "[" + rows + "row" + (rows === 1 ? "" : "s") + " in " + (Date.now() - start) + "ms]";
    let i = 0;
    sql = sql.replace(/\?/g, () => blue(String(i < parameters.length ? parameters[i++] : "⚠️")));
    sql = sql.replace(RESERVED, (w) => bold(w));
    sqlLog.debug(sql.trim() + "  " + bold(white(time)));
  }

  static async query(sql: string, parameters?: Parameter[] | { [key: string]: Parameter }): Promise<Row[]> {
    // If values are not an array, they need to be transformed (as well as the SQL)
    const arrayParameters: Parameter[] = [];
    if (parameters && !Array.isArray(parameters)) {
      sql = DB._transformParameters(sql, parameters, arrayParameters);
      parameters = arrayParameters;
    }

    log.debug({ method: "query", sql: clean(sql), parameters });

    // At this point SQL contains only `?` and the parameters is an array
    try {
      const start = Date.now();
      if (DB.type === Provider.POSTGRES) sql = DB._transformPlaceholders(sql);
      const result = await DB.client.query(DB._sqlFilter(sql), parameters);
      this._logSql(sql, parameters ?? [], result.length ?? 0, start);
      return result;
    } catch (ex) {
      log.error({ method: "query", sql: clean(sql), parameters, message: (ex as Error).message });
      log.trace(ex);
      throw ex;
    }
  }

  static async execute(sql: string, parameters?: Parameter[] | { [key: string]: Parameter }): Promise<{ affectedRows?: number; lastInsertId?: number }> {
    // If values are not an array, they need to be transformed (as well as the SQL)
    const arrayParameters: Parameter[] = [];
    if (parameters && !Array.isArray(parameters)) {
      sql = DB._transformParameters(sql, parameters, arrayParameters);
      parameters = arrayParameters;
    }

    log.debug({ method: "execute", sql: clean(sql), parameters });

    // At this point SQL contains only `?` and the parameters is an array
    try {
      const start = Date.now();
      if (DB.type === Provider.POSTGRES) sql = DB._transformPlaceholders(sql);
      const result = await DB.client.execute(DB._sqlFilter(sql), parameters);
      this._logSql(sql, parameters ?? [], result.affectedRows ?? 0, start);
      return result;
    } catch (ex) {
      log.error({ method: "execute", sql: clean(sql), parameters, message: (ex as Error).message });
      log.trace(ex);
      throw ex;
    }
  }

  // Uses the most standard MySQL syntax, modifies for other DBs inflight
  static async createTable(schema: Schema, type: DB.Provider, execute = true, nameOverride?: string): Promise<string> {
    const sql = DDL.createTable(schema, type, nameOverride);
    if (execute) await DB.execute(sql);
    return sql;
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
    repository = new Repository(target, schema, schema?.table ?? name);
    this.#repositories.set(target, repository as Repository<Identifiable>);

    // Return repository
    return repository;
  }
}

// Debug Client
// deno-fmt-ignore
const RESERVED = new RegExp("\\b(ACCESSIBLE|ADD|ALL|ALTER|ANALYZE|AND|AS|ASC|ASENSITIVE|BEFORE|BETWEEN|BIGINT|BINARY|BLOB|BOTH|BY|CALL|CASCADE|CASE|CHANGE|CHAR|CHARACTER|CHECK|COLLATE|COLUMN|CONDITION|CONSTRAINT|CONTINUE|CONVERT|CREATE|CROSS|CUBE|CUME_DIST|CURRENT_DATE|CURRENT_TIME|CURRENT_TIMESTAMP|CURRENT_USER|CURSOR|DATABASE|DATABASES|DAY_HOUR|DAY_MICROSECOND|DAY_MINUTE|DAY_SECOND|DEC|DECIMAL|DECLARE|DEFAULT|DELAYED|DELETE|DENSE_RANK|DESC|DESCRIBE|DETERMINISTIC|DISTINCT|DISTINCTROW|DIV|DOUBLE|DROP|DUAL|EACH|ELSE|ELSEIF|EMPTY|ENCLOSED|ESCAPED|EXCEPT|EXISTS|EXIT|EXPLAIN|FALSE|FETCH|FIRST_VALUE|FLOAT|FLOAT4|FLOAT8|FOR|FORCE|FOREIGN|FROM|FULLTEXT|FUNCTION|GENERATED|GET|GRANT|GROUP|GROUPING|GROUPS|HAVING|HIGH_PRIORITY|HOUR_MICROSECOND|HOUR_MINUTE|HOUR_SECOND|IF|IGNORE|IN|INDEX|INFILE|INNER|INOUT|INSENSITIVE|INSERT|INT|INT1|INT2|INT3|INT4|INT8|INTEGER|INTERSECT|INTERVAL|INTO|IO_AFTER_GTIDS|IO_BEFORE_GTIDS|IS|ITERATE|JOIN|JSON_TABLE|KEY|KEYS|KILL|LAG|LAST_VALUE|LATERAL|LEAD|LEADING|LEAVE|LEFT|LIKE|LIMIT|LINEAR|LINES|LOAD|LOCALTIME|LOCALTIMESTAMP|LOCK|LONG|LONGBLOB|LONGTEXT|LOOP|LOW_PRIORITY|MASTER_BIND|MASTER_SSL_VERIFY_SERVER_CERT|MATCH|MAXVALUE|MEDIUMBLOB|MEDIUMINT|MEDIUMTEXT|MIDDLEINT|MINUTE_MICROSECOND|MINUTE_SECOND|MOD|MODIFIES|NATURAL|NOT|NO_WRITE_TO_BINLOG|NTH_VALUE|NTILE|NULL|NUMERIC|OF|ON|OPTIMIZE|OPTIMIZER_COSTS|OPTION|OPTIONALLY|OR|ORDER|OUT|OUTER|OUTFILE|OVER|PARTITION|PERCENT_RANK|PRECISION|PRIMARY|PROCEDURE|PURGE|RANGE|RANK|READ|READS|READ_WRITE|REAL|RECURSIVE|REFERENCES|REGEXP|RELEASE|RENAME|REPEAT|REPLACE|REQUIRE|RESIGNAL|RESTRICT|RETURN|REVOKE|RIGHT|RLIKE|ROW|ROWS|ROW_NUMBER|SCHEMA|SCHEMAS|SECOND_MICROSECOND|SELECT|SENSITIVE|SEPARATOR|SET|SHOW|SIGNAL|SMALLINT|SPATIAL|SPECIFIC|SQL|SQLEXCEPTION|SQLSTATE|SQLWARNING|SQL_BIG_RESULT|SQL_CALC_FOUND_ROWS|SQL_SMALL_RESULT|SSL|STARTING|STORED|STRAIGHT_JOIN|SYSTEM|TABLE|TERMINATED|THEN|TINYBLOB|TINYINT|TINYTEXT|TO|TRAILING|TRIGGER|TRUE|UNDO|UNION|UNIQUE|UNLOCK|UNSIGNED|UPDATE|USAGE|USE|USING|UTC_DATE|UTC_TIME|UTC_TIMESTAMP|VALUES|VARBINARY|VARCHAR|VARCHARACTER|VARYING|VIRTUAL|WHEN|WHERE|WHILE|WINDOW|WITH|WRITE|XOR|YEAR_MONTH|ZEROFILL)\\b", "g");

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
