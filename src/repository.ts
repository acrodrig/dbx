import { assert } from "@std/assert";
import { DB } from "./db.ts";
import type { Class, Condition, Filter, Identifiable, Order, Primitive, Schema, Where } from "./types.ts";

// Syntactic Sugar
function join(label: string, count: number, separator = ","): string {
  return new Array(count).fill(label).join(separator);
}

function clean(sql: string) {
  return sql.replaceAll(/[ \n\r\t]+/g, " ").trim();
}

// Column quote character
const CQ = "";

const operators = {
  eq: "=",
  neq: "!=",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  in: "IN",
  contains: "MEMBER OF",
  nin: "NOT IN",
  match: "MATCH",
};

const Hook = {
  AFTER_DELETE: "after-delete",
  AFTER_INSERT: "after-insert",
  AFTER_UPDATE: "after-update",
  BEFORE_DELETE: "before-delete",
  BEFORE_INSERT: "before-insert",
  BEFORE_UPDATE: "before-update",
} as const;

// Loopback like model
export class Repository<T extends Identifiable> extends EventTarget {
  table: string;
  type: Class<T>;
  schema?: Schema;

  // Additional where condition to be added to ALL queries. It is very
  // useful to ensure for example access to only one's own account
  baseWhere?: Condition<T>;

  constructor(type: Class<T>, schema?: Schema, name?: string) {
    super();
    this.type = type;
    this.schema = schema;
    this.table = name ?? schema?.name ?? type.name;
  }

  setBaseWhere(bc: Condition<T>): this {
    this.baseWhere = bc;
    return this;
  }

  // https://dev.mysql.com/doc/refman/8.0/en/select.html
  async all(debug = false): Promise<T[]> {
    const whereTree: Primitive[] = [];
    const sql = `SELECT * FROM ${this.table} WHERE ${Repository._where(this.baseWhere, whereTree)}`;
    const parameters = whereTree;
    if (debug) console.debug({ method: "all", sql: clean(sql), parameters });
    const records = await DB.query(sql, parameters);
    return records.map((r: Record<string, unknown>) => this.fromRecord(r, new this.type()));
  }

  // https://dev.mysql.com/doc/refman/8.0/en/select.html
  // Follow Loopback model (see https://loopback.io/doc/en/lb4/Querying-data.html)
  async count(where: Where<T> = {}, debug?: boolean): Promise<number> {
    assert(typeof where === "object" && !Array.isArray(where), "Parameter 'where' must be an object");

    // Compute where clause
    const whereTree: Primitive[] = [];

    // Build SQL (if there is a select, clean it to prevent SQL injection)
    const _where = Repository._where({ ...where, ...this.baseWhere }, whereTree);
    const parameters = [...whereTree];
    const sql = `SELECT COUNT(1) AS count FROM ${this.table} WHERE ${_where}`;

    if (debug) console.debug({ method: "count", sql: clean(sql), parameters });

    // Run query
    const records = await DB.query(sql, parameters);
    return Number(records.pop()!.count);
  }

  // https://dev.mysql.com/doc/refman/8.0/en/delete.html
  async delete<T>(where: Where<T>, debug?: boolean): Promise<number> {
    // If there is no filter, we are better off returning the results from all
    if (!where) throw new Error("Cannot perform unrestricted DELETE (with no WHERE clause)!");
    assert(typeof where === "object" && !Array.isArray(where), "Parameter 'where' must be an object");

    // Delete restricted to WHERE clause
    const whereTree: Primitive[] = [];
    const sql = `DELETE FROM ${this.table} WHERE ${Repository._where({ ...where, ...this.baseWhere }, whereTree)}`;
    const parameters = whereTree;
    if (debug) console.debug({ method: "delete", sql: clean(sql), parameters });
    const result = await DB.execute(sql, parameters);
    return result.affectedRows ?? -1;
  }

  // https://dev.mysql.com/doc/refman/8.0/en/delete.html
  async deleteById(id: number | string, debug?: boolean): Promise<boolean> {
    assert(typeof id === "number" && Number.isInteger(id), "Parameter 'id' must be an integer");

    const whereTree: Primitive[] = [];
    const sql = `DELETE FROM ${this.table} WHERE id = ? AND ${Repository._where(this.baseWhere, whereTree)}`;
    const parameters = [id, ...whereTree];
    if (debug) console.debug({ method: "delete", sql: clean(sql), parameters });
    this.dispatchEvent(new CustomEvent(Hook.BEFORE_DELETE, { detail: { id } }));
    const result = await DB.execute(sql, parameters);
    this.dispatchEvent(new CustomEvent(Hook.AFTER_DELETE, { detail: { id } }));
    return result.affectedRows === 1;
  }

  // https://dev.mysql.com/doc/refman/8.0/en/select.html
  // Follow Loopback model (see https://loopback.io/doc/en/lb4/Querying-data.html)
  async find(filter: Filter<T> = {}, debug?: boolean): Promise<T[]> {
    // If there is no filter, we are better off returning the results from all
    if (!filter) return this.all();

    assert(typeof filter === "object" && !Array.isArray(filter), "Parameter 'filter' must be an object");

    // Compute where clause
    const whereTree: Primitive[] = [];

    // Extract portions of query
    const where = filter.where ?? {};
    const select = filter.select ?? [];
    const offset = filter.offset ?? 0;
    const limit = filter.limit ?? 100;

    // This is the only method where full text search is permitted (it could be disastrous in DELETE for example)
    const properties = this.schema?.properties ?? {};
    const fullTextColumns = Object.entries(properties).filter(([_, p]) => p.fullText).map(([n, _]) => n);
    if (DB.type === DB.Provider.SQLITE) fullTextColumns.length = 0;

    // Build SQL (if there is a select, clean it to prevent SQL injection)
    const _select = select.length ? select.map((c) => c.replace(/[^a-zA-Z0-9_]/g, "")).join(",") : "*";
    const _where = Repository._where({ ...where, ...this.baseWhere }, whereTree, fullTextColumns);
    const _order = Repository._order(filter.order) || "NULL";
    const parameters = [...whereTree, limit, offset];
    const sql = `SELECT ${_select} FROM ${this.table} WHERE ${_where} ORDER BY ${_order} LIMIT ? OFFSET ?`;

    if (debug) console.debug({ method: "find", sql: clean(sql), parameters });

    // Run query
    const records = await DB.query(sql, parameters);
    return records.map((r: Record<string, unknown>) => this.fromRecord(r, new this.type()));
  }

  // https://dev.mysql.com/doc/refman/8.0/en/select.html
  async findById(id: number | string, debug?: boolean): Promise<T | undefined> {
    assert(typeof id === "number" && Number.isInteger(id), "Parameter 'id' must be an integer");

    const whereTree: Primitive[] = [];
    const sql = `SELECT * FROM ${this.table} WHERE id = ? AND ${Repository._where(this.baseWhere, whereTree)}`;
    const parameters = [id, ...whereTree];
    if (debug) console.debug({ method: "findById", sql: clean(sql), parameters });
    const records = await DB.query(sql, parameters);
    const record = records.pop();
    if (!record) return undefined;
    return this.fromRecord(record, new this.type());
  }

  // https://dev.mysql.com/doc/refman/8.0/en/select.html
  async findOne(filter: Filter<T> = {}, debug?: boolean): Promise<T | undefined> {
    filter.limit = 1;
    return (await this.find(filter, debug)).pop();
  }

  // https://dev.mysql.com/doc/refman/8.0/en/insert.html
  async insert(object: T, debug?: boolean): Promise<T> {
    assert(typeof object === "object" && !Array.isArray(object), "Parameter 'object' must be an object");

    const record = this.toRecord(object);
    const names = Object.keys(record), values = Object.values(record);
    const columns = names.map((name) => "" + CQ + name + CQ + "").join(",");
    const sql = `INSERT INTO ${this.table} (${columns}) VALUES (${join("?", names.length)})${DB.type === DB.Provider.POSTGRES ? " RETURNING id" : ""}`;
    const parameters = [...values];
    if (debug) console.debug({ method: "insert", sql: clean(sql), parameters });
    this.dispatchEvent(new CustomEvent(Hook.BEFORE_INSERT, { detail: object }));
    const result = await DB.execute(sql, parameters as Primitive[]);
    if (!result.lastInsertId) DB.logger.warn({ method: "insert", sql: clean(sql), warning: "Insert did produce a last inserted ID" });
    if (result.lastInsertId) object.id = result.lastInsertId;
    this.dispatchEvent(new CustomEvent(Hook.AFTER_INSERT, { detail: object }));
    return object;
  }

  // https://dev.mysql.com/doc/refman/8.0/en/update.html
  async update(object: Partial<T>, debug?: boolean): Promise<T | undefined> {
    assert(typeof object === "object" && !Array.isArray(object), "Parameter 'object' must be an object");
    assert(typeof (object.id) === "number" && Number.isInteger(object.id), "Parameter 'id' must be an integer");

    const record = this.toRecord(object);
    delete record.id;
    const whereTree: Primitive[] = [];
    const columns = Object.keys(record).map((name) => "" + CQ + name + CQ + "=?").join(",");
    const sql = `UPDATE ${this.table} SET ${columns} WHERE id = ? AND ${Repository._where(this.baseWhere, whereTree)}`;
    const parameters = [...Object.values(record), object.id, ...whereTree];
    if (debug) console.debug({ method: "update", sql: clean(sql), parameters });
    this.dispatchEvent(new CustomEvent(Hook.BEFORE_UPDATE, { detail: object }));
    const result = await DB.execute(sql, parameters as Primitive[]);
    if (result.lastInsertId) object.id = result.lastInsertId;
    this.dispatchEvent(new CustomEvent(Hook.AFTER_UPDATE, { detail: object }));
    if (result.affectedRows === 0) DB.logger.warn({ method: "update", sql: clean(sql), warning: "Update had no affected rows" });
    if (result.affectedRows! > 1) DB.logger.warn({ method: "update", sql: clean(sql), warning: "Update had more than one affected rows" });
    return result.affectedRows === 1 ? object as T : undefined;
  }

  // https://dev.mysql.com/doc/refman/8.0/en/update.html
  updateById(id: number | string, object: Partial<T>, debug = false): Promise<T | undefined> {
    return this.update({ ...object, id }, debug);
  }

  toRecord(object: Partial<T>, record: Record<string, unknown> = {}): Record<string, unknown> {
    const columns = this.schema?.properties;
    const names = Object.keys(columns ?? object);
    names.forEach((n) => {
      const column = columns?.[n];
      if (column && (column.readOnly || column.asExpression || column.dateOn)) return;
      const type = column?.type;
      const value = object[n as keyof typeof object];
      if (typeof value === "undefined") return;
      else if (value === null) record[n] = null;
      else if (type === "boolean") record[n] = !!value;
      else if (type === "date" && (value as unknown) instanceof Date) record[n] = value;
      else if (type === "json") record[n] = JSON.stringify(value);
      // deno-lint-ignore ban-types
      else if ((value as Object).constructor === Object) record[n] = JSON.stringify(value);
      else record[n] = value;
    });
    return record;
  }

  fromRecord(record: Record<string, unknown>, object: { [key in string]?: unknown } = {}): T {
    const columns = this.schema?.properties;
    const names = Object.keys(record);
    names.forEach((n) => {
      const type = columns?.[n]?.type;
      const value = record[n];
      if (typeof value === "undefined") return;
      else if (value === null) object[n] = null;
      else if (type === "boolean") object[n] = !!value;
      else if (type === "date") object[n] = new Date(value as string);
      else if (type === "json") object[n] = typeof value === "string" ? JSON.parse(value) : value;
      else if (typeof value === "string" && value.startsWith("{") && value.endsWith("}")) object[n] = JSON.parse(value as string);
      else object[n] = value;
    });
    return object as T;
  }

  // Meta specifies that it will use ?? as literal parameter for the SQL query (valid in MySQL)
  static _where<T>(where?: Where<T>, tree: Primitive[] = [], fullTextColumns: string[] = []): string {
    const entries = Object.entries(where ?? {});
    const expressions = [];
    for (const [name, value] of entries) {
      const st: Primitive[] = [], ses = [];
      if (name === "and") {
        for (const w of value) ses.push(Repository._where(w, st, fullTextColumns));
        tree.push(...st);
        expressions.push("(" + ses.join(" AND ") + ")");
        break;
      }
      if (name === "or") {
        for (const w of value) ses.push(Repository._where(w, st, fullTextColumns));
        tree.push(...st);
        expressions.push("(" + ses.join(" OR ") + ")");
        break;
      }

      // Predicate
      const keys = Object.keys(value || {}), key = keys.pop()!;
      const column = CQ + name + CQ;
      let op = operators[key as keyof typeof operators];

      if (op === operators.match) {
        // Special case for FULLTEXT (if the matching value is NOT truthy we skip)
        if (!value[key]) continue;

        tree.push(fullTextColumns?.length ? value[key] + (DB.type === DB.Provider.POSTGRES ? "" : "*") : "%" + value[key] + "%");

        // Regardless of what we are looking for, MySQL wants us to enter every column here
        const wrapper = (columns: string[], s = ",", w = false) => columns.map((c) => w ? "COALESCE(" + c + ",'')" : c).join(s);
        if (fullTextColumns?.length) {
          if (DB.type === DB.Provider.MYSQL) expressions.push("MATCH (" + wrapper(fullTextColumns) + ") AGAINST (? IN BOOLEAN MODE)");
          if (DB.type === DB.Provider.POSTGRES) expressions.push("TO_TSVECTOR('english', " + wrapper(fullTextColumns) + ") @@ TO_TSQUERY(?)");
        } else expressions.push(column + " LIKE ?");
      } else if (column === "$sql") {
        // Special case for $sql
        expressions.push(value);
      } else if (key && op) {
        // Normal case
        const explode = op === operators.in || op === operators.nin;
        if (explode) tree.push(...value[key]);
        else tree.push(value[key]);

        // Special case for NULL since `column IS NULL` is something different than `column = NULL`
        if (value[key] === null) {
          if (key === "eq") op = "IS";
          if (key === "neq") op = "IS NOT";
        }

        // See this SQ for Postgres operators: https://stackoverflow.com/a/38374876/2772798
        if (key === "contains") {
          if (DB.type === DB.Provider.MYSQL) expressions.push("? " + op + " (" + column + ")");
          if (DB.type === DB.Provider.POSTGRES) expressions.push("JSONB_EXISTS(CAST(" + column + " AS JSONB), ?)");
          if (DB.type === DB.Provider.SQLITE) expressions.push(column + " LIKE ?");
        } else expressions.push(column + " " + op + (explode ? " (" + join("?", value[key].length) + ")" : " ?"));
      } else {
        tree.push(value);
        expressions.push(column + " " + (value === null ? "IS" : "=") + " ?");
      }
    }
    return expressions.join(" AND ") || "TRUE";
  }

  static _order<T>(order?: Order<T>): string {
    const expressions = [];
    for (const [name, value] of Object.entries(order ?? {})) {
      expressions.push(name + (value === "DESC" ? " DESC" : " ASC"));
    }
    return expressions.join(",");
  }
}
