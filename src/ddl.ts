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

const _BaseSchema: DB.Schema = {
  table: "_BaseSchema",
  properties: {
    id: { type: "integer", primaryKey: true, description: "Unique identifier, auto-generated. It's the primary key." },
    insertedAt: { type: "date", dateOn: "insert", description: "Timestamp when current record is inserted" },
    updatedAt: { type: "date", dateOn: "update", description: "Timestamp when current record is updated" },
    etag: { type: "string", maxLength: 1024, description: "Possible ETag for all resources that are external. Allows for better synch-ing." },
  },
  indices: [
    { properties: ["insertedAt"] },
    { properties: ["updatedAt"] },
  ],
};

export class DDL {
  static EXTENSIONS = ["as", "constraints", "dateOn", "fullText", "index", "primaryKey", "relations", "table"];

  static padWidth = 4;
  static defaultWidth = 128;
  static textWidth = 2048;

  /**
   * When using tools such as [TJS](https://github.com/YousefED/typescript-json-schema) to
   * generate JSON schemas from TypeScript classes, the resulting schema may need some
   * cleaning up. This function does that.
   *
   * @param schema - the tool-generated schema
   * @param type - the type of the schema which we may need to correct/override
   * @param table - the table name which we may need to correct/override
   */
  static cleanSchema(schema: Schema, type?: string, table?: string): Schema {
    if (type) schema.type = type;
    if (table) schema.table = table;
    if (typeof (schema.fullText) === "string") schema.fullText = (schema.fullText as string).split(",").map((s) => s.trim());
    schema.indices ??= [];
    Object.values(schema.properties).forEach((c) => {
      if (!c.type) c.type = "string";
      if (typeof c.primaryKey === "string") c.primaryKey = true;
      if (typeof c.uniqueItems === "string") c.uniqueItems = true;
      if (c.format === "date-time") c.type = "date";
      if (typeof c.index === "string") schema.indices!.push({ properties: (c.index as string).split(",").map((s) => s.trim()) });
    });
    return schema;
  }

  // Enhance schema with standard properties
  static enhanceSchema(schema: Schema, selected: string[] = ["id", "insertedAt", "updatedAt"]): Schema {
    // Select properties that match the selected columns and add them to the schema
    if (!schema.properties) schema.properties = {};
    for (const name of selected) schema.properties[name] = _BaseSchema.properties[name];

    // Select indices
    if (!schema.indices) schema.indices = [];
    if (selected.includes("insertedAt")) schema.indices.push({ properties: ["insertedAt"] });
    if (selected.includes("updatedAt")) schema.indices.push({ properties: ["updatedAt"] });

    return schema;
  }

  static #defaultValue(column: Column, dbType: string) {
    console.log(column);
    if (column.dateOn === "insert") return "CURRENT_TIMESTAMP";
    if (column.dateOn === "update") return "CURRENT_TIMESTAMP" + ((dbType !== DB.Provider.MYSQL) ? "" : " ON UPDATE CURRENT_TIMESTAMP");
    if (typeof (column.default) === "string" && !column.default.startsWith("'") && !column.default.endsWith("'")) return "'" + column.default + "'";
    if (typeof (column.default) === "object") return "('" + JSON.stringify(column.default) + "')";
    return column.default;
  }

  // Column generator
  static createColumn(dbType: string, name: string, column: Column, required: boolean, namePad: number, padWidth = DDL.padWidth, defaultWidth = DDL.defaultWidth): string {
    const pad = "".padEnd(padWidth);
    let type = dataTypes[column.type as keyof typeof dataTypes];
    if (dbType === DB.Provider.MYSQL && column.maxLength! > this.textWidth) type = "TEXT";
    const primaryKey = column.primaryKey !== undefined;
    const autoIncrement = primaryKey && column.type === "integer";
    const length = column.maxLength! < this.textWidth || type.endsWith("CHAR") ? "(" + (column.maxLength ?? defaultWidth) + ")" : "";
    const nullable = primaryKey || required ? " NOT NULL" : "";
    const gen = autoIncrement ? serialType[dbType as keyof typeof serialType] : "";
    const expr = column.as && (typeof column.as === "string" ? DB._sqlFilter(column.as) : column.as[dbType]);
    const as = expr ? " GENERATED ALWAYS AS (" + expr + ") STORED" : "";
    const def = Object.hasOwn(column, "default")|| Object.hasOwn(column, "dateOn") ? " DEFAULT " + this.#defaultValue(column, dbType) : "";
    const key = primaryKey ? " PRIMARY KEY" : (column.uniqueItems !== undefined ? " UNIQUE" : "");
    const comment = (dbType === DB.Provider.MYSQL) && column.description ? " COMMENT '" + column.description.replace(/'/g, "''") + "'" : "";

    // Correct Postgres JSON type
    if (dbType === DB.Provider.POSTGRES && type === "JSON") type = "JSONB";
    if (dbType === DB.Provider.POSTGRES && autoIncrement) type = "SERIAL";

    return `${pad}${name.padEnd(namePad)}${type}${length}${nullable}${as}${def}${key}${gen}${comment},\n`;
  }

  // Index generator
  static createIndex(dbType: string, index: Index, padWidth = 4, table: string): string {
    const pad = "".padEnd(padWidth);
    const columns = [...index.properties] as string[];
    const name = columns.join("_");

    // If there is an array expression, replace the column by it
    // TODO: multivalued indexes only supported on MYSQL for now, Postgres and SQLite will use the entire
    const subType = index.subType ?? "CHAR(32)";
    if (index.array !== undefined) {
      columns[index.array] = "(CAST(" + columns[index.array] + " AS " + subType + (dbType === DB.Provider.MYSQL ? " ARRAY" : "") + "))";
    }

    const unique = index.unique ? "UNIQUE " : "";
    return `${pad}CREATE ${unique}INDEX ${table}_${name} ON ${table} (${columns.join(",")});\n`;
  }

  static createFullTextIndex(dbType: string, columns: string[], padWidth = 4, table: string, name = "fulltext"): string {
    const pad = "".padEnd(padWidth);

    const wrapper = (columns: string[], s = ",", w = false) => columns.map((c) => w ? "COALESCE(" + c + ",'')" : c).join(s);
    if (dbType === DB.Provider.MYSQL) return `${pad}CREATE FULLTEXT INDEX ${table}_${name} ON ${table} (${wrapper(columns, ",")});\n`;
    if (dbType === DB.Provider.POSTGRES) return `${pad}CREATE INDEX ${table}_${name} ON ${table} USING GIN (TO_TSVECTOR('english', ${wrapper(columns, "||' '||", true)}));`;

    return "";
  }

  // Relation generator
  static createRelation(_dbType: string, parent: string, name: string, relation: Relation, padWidth = 4): string {
    const pad = "".padEnd(padWidth);
    const da = relation.delete ? " ON DELETE " + relation.delete?.toUpperCase().replace(/-/g, " ") : "";
    const ua = relation.update ? " ON DELETE " + relation.update?.toUpperCase().replace(/-/g, " ") : "";
    name = parent + "_" + name;
    return `${pad}CONSTRAINT ${name} FOREIGN KEY (${relation.join}) REFERENCES ${relation.target} (id)${da}${ua},\n`;
  }

  // Constraint independent generator
  static createColumnConstraint(_dbType: string, parent: string, name: string, column: Column, padWidth = 4): string {
    const pad = "".padEnd(padWidth);
    const value = (v: number | string) => typeof v === "string" ? "'" + v + "'" : v;
    let expr = "";
    if (column.maximum) expr += `${name} >= ${value(column.maximum)}`;
    if (column.minimum) expr += `${name} >= ${value(column.minimum)}`;
    name = parent + "_" + name;
    return expr ? `${pad}${name ? "CONSTRAINT " + name + " " : ""}CHECK (${expr}),\n` : "";
  }

  // Constraint independent generator
  static createIndependentConstraint(_dbType: string, parent: string, constraint: Constraint, padWidth = 4): string {
    const pad = "".padEnd(padWidth), simple = typeof constraint === "string";
    const name = simple ? undefined : (parent + "_" + constraint.name).toLowerCase();
    const expr = simple ? constraint : constraint.check;
    return `${pad}${name ? "CONSTRAINT " + name + " " : ""}CHECK (${expr}),\n`;
  }

  // Uses the most standard MySQL syntax, and then it is fixed afterward
  static createTable(schema: Schema, dbType: DB.Provider, nameOverride?: string): string {
    // Get name padding
    const namePad = Math.max(...Object.keys(schema.properties).map((n) => n.length || 0)) + 1;

    // Check with if type is SQLite since it is the most restrictive
    const sqlite = dbType === DB.Provider.SQLITE;

    // Create SQL
    const table = nameOverride ?? schema.table! ?? schema.type?.toLowerCase();
    const required = (n: string) => schema.required?.includes(n) || false;
    const columns = Object.entries(schema.properties).map(([n, c]) => this.createColumn(dbType, n, c!, required(n), namePad)).join("");
    const relations = !sqlite && Object.entries(schema.relations || []).map(([n, r]) => this.createRelation(dbType, table, n, r!)).join("") || "";

    // Create constraints
    const filter = (c: Constraint) => !c.provider || c.provider === dbType;
    const columnConstraints = Object.entries(schema.properties || {}).map(([n, c]) => this.createColumnConstraint(dbType, table, n, c));
    const independentConstraints = (schema.constraints || []).filter(filter).map((c) => this.createIndependentConstraint(dbType, table, c));
    const constraints = !sqlite && [...columnConstraints, ...independentConstraints].join("") || "";

    // Create sql
    let sql = `CREATE TABLE IF NOT EXISTS ${table} (\n${columns}${relations}${constraints})`;

    // Independent indexes
    if (schema.indices) sql += "\n" + schema.indices?.map((i) => this.createIndex(dbType, i, 0, table)).join("");

    // Full text index
    if (schema.fullText?.length) sql += this.createFullTextIndex(dbType, schema.fullText, 0, table);

    const fixDanglingComma = (sql: string) => sql.replace(/,\n\)/, "\n);");
    if (dbType === DB.Provider.POSTGRES) sql = this.#postgres(sql);
    sql = fixDanglingComma(sql);

    return sql;
  }

  // Function to accommodate the differences between MySQL and Postgres
  static #postgres(sql: string) {
    return sql.replace(/\w+/g, (m: string) => {
      if (m === "DATETIME") return "TIMESTAMP";
      if (m === "JSON_EXTRACT") return "JSONB_EXTRACT_PATH";
      if (m === "RLIKE") return "~*";
      return m;
    });
  }
}
