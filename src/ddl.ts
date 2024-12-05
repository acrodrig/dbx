import { Column, Constraint, Index, Relation, Schema } from "./types.ts";
import DB from "./db.ts";

const dataTypes = {
  boolean: "BOOLEAN",
  date: "DATETIME",
  integer: "INTEGER",
  json: "JSON",
  number: "DOUBLE",
  string: "VARCHAR",
};

const serialType = {
  sqlite: " AUTOINCREMENT",
  mysql: " AUTO_INCREMENT",
  mysql2: " AUTO_INCREMENT",
  postgres: "",
};

const _BaseSchema: DB.Schema = {
  name: "_BaseSchema",
  properties: {
    id: { type: "integer", required: true, primaryKey: true, comment: "Unique identifier, auto-generated. It's the primary key." },
    insertedAt: { type: "date", required: false, dateOn: "insert", comment: "Timestamp when current record is inserted" },
    updatedAt: { type: "date", required: false, dateOn: "update", comment: "Timestamp when current record is updated" },
    etag: { type: "string", required: false, maxLength: 1024, comment: "Possible ETag for all resources that are external. Allows for better synch-ing." },
  },
  indices: [
    { name: "insertedAt", properties: ["insertedAt"] },
    { name: "updatedAt", properties: ["updatedAt"] },
  ],
};

export class DDL {
  static padWidth = 4;
  static defaultWidth = 256;

  // Enhance schema with standard properties
  static enhanceSchema(schema: Schema, selected: string[] = ["id", "insertedAt", "updatedAt"]): Schema {
    // Select properties that match the selected columns and add them to the schema
    if (!schema.properties) schema.properties = {};
    for (const name of selected) schema.properties[name] = _BaseSchema.properties[name];

    // Select indices
    if (!schema.indices) schema.indices = [];
    for (const name of selected) {
      const index = _BaseSchema.indices?.find((i) => i.name === name);
      if (index) schema.indices.push(index);
    }

    return schema;
  }

  // Column generator
  static createColumn(dbType: string, name: string, column: Column, namePad: number, padWidth = DDL.padWidth, defaultWidth = DDL.defaultWidth): string {
    if (typeof (column.default) === "object") column.default = "('" + JSON.stringify(column.default) + "')";
    if (column.dateOn === "insert") column.default = "CURRENT_TIMESTAMP";
    if (column.dateOn === "update") column.default = "CURRENT_TIMESTAMP" + ((dbType !== DB.Provider.MYSQL && dbType !== DB.Provider.MYSQL2) ? "" : " ON UPDATE CURRENT_TIMESTAMP");
    const pad = "".padEnd(padWidth);
    let type = dataTypes[column.type as keyof typeof dataTypes];
    const autoIncrement = column.primaryKey && column.type === "integer";
    const length = column.maxLength || type.endsWith("CHAR") ? "(" + (column.maxLength ?? defaultWidth) + ")" : "";
    const nullable = column.primaryKey || column.required ? " NOT NULL" : "";
    const gen = autoIncrement ? serialType[dbType as keyof typeof serialType] : "";
    const asExpression = column.asExpression && (typeof column.asExpression === "string" ? DB._sqlFilter(column.asExpression) : column.asExpression[dbType]);
    const as = asExpression ? " GENERATED ALWAYS AS (" + asExpression + ") " + (column.generatedType?.toUpperCase() || "VIRTUAL") : "";
    const def = Object.hasOwn(column, "default") ? " DEFAULT " + column.default : "";
    const key = column.primaryKey ? " PRIMARY KEY" : (column.unique ? " UNIQUE" : "");
    const comment = (dbType === DB.Provider.MYSQL || dbType === DB.Provider.MYSQL2) && column.comment ? " COMMENT '" + column.comment.replace(/'/g, "''") + "'" : "";

    // Correct Postgres JSON type
    if (dbType === DB.Provider.POSTGRES && type === "JSON") type = "JSONB";
    if (dbType === DB.Provider.POSTGRES && autoIncrement) type = "SERIAL";

    return `${pad}${name.padEnd(namePad)}${type}${length}${nullable}${as}${def}${key}${gen}${comment},\n`;
  }

  // Index generator
  static createIndex(dbType: string, indice: Index, padWidth = 4, table: string): string {
    const pad = "".padEnd(padWidth);
    const columns = [...indice.properties] as string[];

    // If there is an array expression, replace the column by it
    // TODO: multivalued indexes only supported on MYSQL for now, Postgres and SQLite will use the entire
    const subType = indice.subType ?? "CHAR(32)";
    if (indice.array !== undefined) {
      columns[indice.array] = "(CAST(" + columns[indice.array] + " AS " + subType + (dbType === DB.Provider.MYSQL || dbType === DB.Provider.MYSQL2 ? " ARRAY" : "") + "))";
    }

    const name = indice.name ?? "";
    const unique = indice.unique ? "UNIQUE " : "";
    return `${pad}CREATE ${unique}INDEX ${table}_${name} ON ${table} (${columns.join(",")});\n`;
  }

  static createFullTextIndex(dbType: string, columns: string[], padWidth = 4, table: string, name = "fulltext"): string {
    const pad = "".padEnd(padWidth);

    const wrapper = (columns: string[], s = ",", w = false) => columns.map((c) => w ? "COALESCE(" + c + ",'')" : c).join(s);
    if (dbType === DB.Provider.MYSQL) return `${pad}CREATE FULLTEXT INDEX ${table}_${name} ON ${table} (${wrapper(columns, ",")});\n`;
    if (dbType === DB.Provider.MYSQL2) return `${pad}CREATE FULLTEXT INDEX ${table}_${name} ON ${table} (${wrapper(columns, ",")});\n`;
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
    const table = nameOverride ?? schema.name;
    const columns = Object.entries(schema.properties).map(([n, c]) => this.createColumn(dbType, n, c!, namePad)).join("");
    const relations = !sqlite && Object.entries(schema.relations || []).map(([n, r]) => this.createRelation(dbType, schema.name, n, r!)).join("") || "";

    // Create constraints
    const filter = (c: Constraint) => !c.provider || c.provider === dbType;
    const columnConstraints = Object.entries(schema.properties || {}).map(([n, c]) => this.createColumnConstraint(dbType, schema.name, n, c));
    const independentConstraints = (schema.constraints || []).filter(filter).map((c) => this.createIndependentConstraint(dbType, schema.name, c));
    const constraints = !sqlite && [...columnConstraints, ...independentConstraints].join("") || "";

    // Create sql
    let sql = `CREATE TABLE IF NOT EXISTS ${table} (\n${columns}${relations}${constraints})`;

    // Independent indexes
    if (schema.indices) sql += "\n" + schema.indices?.map((i) => this.createIndex(dbType, i, 0, table)).join("");

    // Full text index
    const fullTextColumns = Object.entries(schema.properties).filter(([_, c]) => c.fullText).map(([n, _]) => n);
    if (fullTextColumns.length) sql += this.createFullTextIndex(dbType, fullTextColumns, 0, table);

    const fixDanglingComma = (sql: string) => sql.replace(/,\n\)/, "\n);");
    if (dbType === DB.Provider.POSTGRES) sql = this.postgres(sql);
    sql = fixDanglingComma(sql);

    return sql;
  }

  // Function to accommodate the differences between MySQL and Postgres
  static postgres(sql: string) {
    return sql.replace(/\w+/g, (m: string) => {
      if (m === "DATETIME") return "TIMESTAMP";
      if (m === "JSON_EXTRACT") return "JSONB_EXTRACT_PATH";
      if (m === "RLIKE") return "~*";
      return m;
    });
  }
}
