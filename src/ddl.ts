import type { Column, Constraint, Index, Relation, Schema } from "./types.ts";
import DB from "./db.ts";

const dataTypes = {
  array: "JSON",
  boolean: "BOOLEAN",
  date: "DATETIME",
  integer: "INTEGER",
  object: "JSON",
  number: "DOUBLE",
  string: "VARCHAR",
};

const serialType = {
  sqlite: " AUTOINCREMENT",
  mysql: " AUTO_INCREMENT",
  postgres: "",
};

export const BaseSchema: Schema = {
  table: "_BaseSchema",
  properties: {
    id: { type: "integer", primaryKey: true, description: "Unique identifier, auto-generated. It's the primary key." },
    etag: { type: "string", maxLength: 1024, description: "Possible ETag for all resources that are external. Allows for better synch-ing." },
    inserted: { type: "date", dateOn: "insert", index: ["inserted"], description: "Timestamp when current record is inserted" },
    updated: { type: "date", dateOn: "update", index: ["updated"], description: "Timestamp when current record is updated" },
  },
};

export class DDL {
  static EXTENSIONS = ["as", "constraint", "dateOn", "fullText", "index", "primaryKey", "relations", "unique", "table"];

  static padWidth = 4;
  static defaultWidth = 128;
  static textWidth = 2048;

  /**
   * Small utility to validate parameters
   */
  static #ensureProvider(provider: string) {
    const values: string[] = Object.values(DB.Provider);
    const message = "Unknown provider '" + provider + "' - should be one of '" + values.join(" | ") + "'";
    if (!values.includes(provider)) throw new Error(message);
  }

  static #defaultValue(column: Column, provider: string) {
    const cd = column.default;

    // Automatically inserted/updated values
    if (column.dateOn === "insert") return "CURRENT_TIMESTAMP";
    if (column.dateOn === "update") return "CURRENT_TIMESTAMP" + ((provider !== DB.Provider.MYSQL) ? "" : " ON UPDATE CURRENT_TIMESTAMP");

    // Generated fields should NOT have a default value
    if (column.as) return undefined;

    // Respect object defaults as well as auto-quote strings
    if (typeof cd === "string" && cd.startsWith("('") && cd.endsWith("')")) return cd;
    if (typeof cd === "string" && !cd.startsWith("'") && !cd.endsWith("'")) return "'" + cd + "'";
    if (typeof cd === "object") return "('" + JSON.stringify(cd) + "')";

    return cd;
  }

  // Enhance schema with standard properties
  static enhanceSchema(schema: Schema, selected: string[] = ["id", "inserted", "updated"]): Schema {
    // Select properties that match the selected columns and add them to the schema
    if (!schema.properties) schema.properties = {};
    for (const name of selected) {
      if (schema.properties[name]) continue;
      schema.properties[name] = BaseSchema.properties[name];
    }
    return schema;
  }

  // Column generator
  static createColumn(provider: string, name: string, column: Column, required: boolean, namePad: number, padWidth = DDL.padWidth, defaultWidth = DDL.defaultWidth): string {
    console.debug({ method: "createColumn", provider, name, column, required, namePad, padWidth, defaultWidth });
    this.#ensureProvider(provider);

    const pad = "".padEnd(padWidth);
    let type = dataTypes[column.type as keyof typeof dataTypes];
    if (!type) throw new Error("Unknown type '" + column.type + "' for column '" + name + "' (known types are " + Object.keys(dataTypes).join(", ") + ")");

    if (provider === DB.Provider.MYSQL && column.maxLength! > this.textWidth) type = "TEXT";
    const primaryKey = column.primaryKey !== undefined;
    const autoIncrement = primaryKey && column.type === "integer";
    const length = column.maxLength! < this.textWidth || type.endsWith("CHAR") ? "(" + (column.maxLength ?? defaultWidth) + ")" : "";
    const nullable = primaryKey || required ? " NOT NULL" : "         ";
    const gen = autoIncrement ? (serialType[provider as keyof typeof serialType] ?? "UNKNOWN") : "";
    const expr = column.as && (typeof column.as === "string" ? DB._sqlFilter(column.as) : column.as[provider]);
    const as = expr ? " GENERATED ALWAYS AS (" + expr + ") STORED" : "";
    const dv = this.#defaultValue(column, provider);
    // const def = Object.hasOwn(column, "default") || Object.hasOwn(column, "dateOn") ? " DEFAULT " + this.#defaultValue(column, dbType) : "";
    const key = primaryKey ? " PRIMARY KEY" : (column.unique !== undefined ? " UNIQUE" : "");
    const comment = (provider === DB.Provider.MYSQL) && column.description ? " COMMENT '" + column.description.replace(/'/g, "''") + "'" : "";

    // Correct Postgres JSON type
    if (provider === DB.Provider.POSTGRES && type === "JSON") type = "JSONB";
    if (provider === DB.Provider.POSTGRES && autoIncrement) type = "SERIAL";

    return `${pad}${name.padEnd(namePad)}${(type + length).padEnd(13)}${nullable}${as}${dv ? " DEFAULT " + dv : ""}${key}${gen}${comment},\n`;
  }

  // Index generator
  static createIndex(provider: string, index: Index, padWidth = 4, table: string): string {
    console.debug({ method: "createIndex", provider, index, padWidth, table });
    this.#ensureProvider(provider);

    const pad = "".padEnd(padWidth);
    const columns = [...index.properties] as string[];
    const name = columns.join("_");

    // If there is an array expression, replace the column by it
    // TODO: multivalued indexes only supported on MYSQL for now, Postgres and SQLite will use the entire
    const subType = index.subType ?? "CHAR(32)";
    if (index.array !== undefined) {
      columns[index.array] = "(CAST(" + columns[index.array] + " AS " + subType + (provider === DB.Provider.MYSQL ? " ARRAY" : "") + "))";
    }

    const unique = index.unique ? "UNIQUE " : "";
    return `${pad}CREATE ${unique}INDEX ${table}_${name} ON ${table} (${columns.join(",")});\n`;
  }

  static createFullTextIndex(provider: string, columns: string[], padWidth = 4, table: string, name = "fulltext"): string {
    console.debug({ method: "createFullTextIndex", provider, columns, padWidth, table, name });
    this.#ensureProvider(provider);

    const pad = "".padEnd(padWidth);

    const wrapper = (columns: string[], s = ",", w = false) => columns.map((c) => w ? "COALESCE(" + c + ",'')" : c).join(s);
    if (provider === DB.Provider.MYSQL) return `${pad}CREATE FULLTEXT INDEX ${table}_${name} ON ${table} (${wrapper(columns, ",")});\n`;
    if (provider === DB.Provider.POSTGRES) return `${pad}CREATE INDEX ${table}_${name} ON ${table} USING GIN (TO_TSVECTOR('english', ${wrapper(columns, "||' '||", true)}));`;

    return "";
  }

  // Relation generator
  static createRelation(provider: string, parent: string, name: string, relation: Relation, padWidth = 4): string {
    console.debug({ method: "createRelation", provider, parent, name, relation, padWidth });
    this.#ensureProvider(provider);

    const pad = "".padEnd(padWidth);
    const da = relation.delete ? " ON DELETE " + relation.delete?.toUpperCase().replace(/-/g, " ") : "";
    const ua = relation.update ? " ON DELETE " + relation.update?.toUpperCase().replace(/-/g, " ") : "";
    name = parent + "_" + name;
    return `${pad}CONSTRAINT ${name} FOREIGN KEY (${relation.join}) REFERENCES ${relation.target} (id)${da}${ua},\n`;
  }

  // Constraint independent generator
  static createColumnConstraint(provider: string, parent: string, name: string, column: Column, padWidth = 4): string {
    console.debug({ method: "createColumnConstraint", provider, parent, name, column, padWidth });
    this.#ensureProvider(provider);

    const pad = "".padEnd(padWidth);
    const value = (v: number | string) => typeof v === "string" ? "'" + v + "'" : v;
    let expr = "";
    if (column.constraint) expr = column.constraint;
    else if (column.maximum) expr += `${name} >= ${value(column.maximum)}`;
    else if (column.minimum) expr += `${name} >= ${value(column.minimum)}`;
    name = parent + "_" + name;
    return expr ? `${pad}${name && provider !== "sqlite" ? "CONSTRAINT " + name + " " : ""}CHECK (${expr}),\n` : "";
  }

  // Constraint independent generator
  static createIndependentConstraint(provider: string, parent: string, constraint: Constraint, padWidth = 4): string {
    console.debug({ method: "createIndependentConstraint", provider, parent, constraint, padWidth });
    this.#ensureProvider(provider);

    const pad = "".padEnd(padWidth), simple = typeof constraint === "string";
    const name = simple ? undefined : (parent + "_" + constraint.name).toLowerCase();
    const expr = simple ? constraint : constraint.check;
    return `${pad}${name && provider !== "sqlite" ? "CONSTRAINT " + name + " " : ""}CHECK (${expr}),\n`;
  }

  // Uses the most standard MySQL syntax, and then it is fixed afterward
  static createTable(schema: Schema, provider: DB.Provider, nameOverride?: string, safe?: boolean): string {
    console.debug({ method: "createTable", schema, provider, nameOverride });
    this.#ensureProvider(provider);

    // Get name padding
    const namePad = Math.max(...Object.keys(schema.properties).map((n) => n.length || 0)) + 1;

    // Check with if type is SQLite since it is the most restrictive
    const sqlite = provider === DB.Provider.SQLITE;

    // Create SQL
    const table = nameOverride ?? schema.table! ?? schema.type?.toLowerCase();
    const required = (n: string) => schema.required?.includes(n) || false;
    const columns = Object.entries(schema.properties).map(([n, c]) => this.createColumn(provider, n, c!, required(n), namePad)).join("");
    const relations = !sqlite && Object.entries(schema.relations || []).map(([n, r]) => this.createRelation(provider, table, n, r!)).join("") || "";

    // Create constraints (and sort lines for consistency)
    const filter = (c: Constraint) => !c.provider || c.provider === provider;
    const columnConstraints = Object.entries(schema.properties || {}).map(([n, c]) => this.createColumnConstraint(provider, table, n, c));
    const independentConstraints = (schema.constraints || []).filter(filter).map((c) => this.createIndependentConstraint(provider, table, c));
    const constraints = [...columnConstraints, ...independentConstraints].sort().join("");

    // Create sql
    let sql = `CREATE TABLE ${safe ? " IF NOT EXISTS" : ""}${table} (\n${columns}${relations}${constraints})`;

    // Independent indexes (and sort lines for consistency)
    const indices = schema.indices?.slice() ?? [];
    Object.values(schema.properties).forEach((c) => {
      if (!c.index?.length) return;
      const types = c.index!.map((n) => schema.properties[n].type);
      const array = types.includes("array") ? types.indexOf("array") : undefined;
      indices!.push({ properties: c.index!, array });
    });
    if (indices.length) sql += "\n" + indices?.map((i) => this.createIndex(provider, i, 0, table)).sort().join("");

    // Full text index
    if (schema.fullText?.length) sql += this.createFullTextIndex(provider, schema.fullText, 0, table);

    const fixDanglingComma = (sql: string) => sql.replace(/,\n\)/, "\n);");
    if (provider === DB.Provider.POSTGRES) sql = this.#postgres(sql);
    sql = fixDanglingComma(sql);

    return sql;
  }

  // Function to accommodate the differences between MySQL and Postgres
  static #postgres(sql: string) {
    return sql.replace(/\w+/g, (m: string) => {
      if (m === "DATETIME") return "TIMESTAMP";
      if (m === "JSON_EXTRACT") return "JSONB_EXTRACT_PATH";
      if (m === "RLIKE") return "~*";
      if (m === "REGEXP") return "~*";
      return m;
    });
  }
}
