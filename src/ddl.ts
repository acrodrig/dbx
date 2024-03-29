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
  static milliPrecision = 3;
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
    // const sqlite = dbType === "sqlite", postgres = dbType === "postgres", other = sqlite || postgres;

    if (typeof (column.default) === "object") column.default = "('" + JSON.stringify(column.default) + "')";
    if (column.dateOn === "insert") column.default = "CURRENT_TIMESTAMP";
    if (column.dateOn === "update") column.default = "CURRENT_TIMESTAMP" + (dbType !== "mysql" ? "" : " ON UPDATE CURRENT_TIMESTAMP");
    const pad = "".padEnd(padWidth);
    const type = dataTypes[column.type as keyof typeof dataTypes];
    const autoIncrement = column.primaryKey && column.type === "integer";
    const length = column.maxLength || type.endsWith("CHAR") ? "(" + (column.maxLength ?? defaultWidth) + ")" : "";
    const nullable = column.primaryKey || column.required ? " NOT NULL" : "";
    const gen = autoIncrement ? (dbType === "sqlite" ? " AUTOINCREMENT" : " AUTO_INCREMENT") : "";
    const asExpression = column.asExpression && (typeof column.asExpression === "string" ? DB._sqlFilter(column.asExpression) : column.asExpression[dbType]);
    const as = asExpression ? " GENERATED ALWAYS AS (" + asExpression + ") " + (column.generatedType?.toUpperCase() || "VIRTUAL") : "";
    const def = Object.hasOwn(column, "default") ? " DEFAULT " + column.default : "";
    const key = column.primaryKey ? " PRIMARY KEY" : (column.unique ? " UNIQUE" : "");
    const comment = dbType === "mysql" && column.comment ? " COMMENT '" + column.comment.replace(/'/g, "''") + "'" : "";
    return `${pad}${name.padEnd(namePad)}${type}${length}${nullable}${as}${def}${key}${gen}${comment},\n`;
  }

  // Index generator
  // If we pass a table name it will create an independent expression
  static createIndex(dbType: string, indice: Index, padWidth = 4, table?: string): string {
    const pad = "".padEnd(padWidth);
    const columns = [...indice.properties] as string[];
    const key = indice.fulltext ? "FULLTEXT" : "INDEX";
    const ine = table ? " IF NOT EXISTS" : "";
    const end = table ? ";" : ",";

    // If there is an array expression, replace the column by it
    // TODO: multivalued indexes only supported on MYSQL for now, Postgres and SQLite will use the entire
    const subType = indice.subType ?? "CHAR(32)";
    if (indice.array !== undefined) columns[indice.array] = "(CAST(" + columns[indice.array] + " AS " + subType + (dbType === "mysql" ? " ARRAY" : "") + "))";

    const name = indice.name ?? "";
    const unique = indice.unique ? "UNIQUE " : "";
    return `${pad}${table ? "CREATE " : ""}${unique}${key}${ine} ${table ? table + "_" : ""}${name}${table ? " ON " + table : ""} (${columns.join(",")})${end}\n`;
  }

  // Relation generator
  static createRelation(_dbType: string, parent: string, name: string, relation: Relation, padWidth = 4): string {
    const pad = "".padEnd(padWidth);
    const da = relation.delete ? " ON DELETE " + relation.delete?.toUpperCase().replace(/-/g, " ") : "";
    const ua = relation.update ? " ON DELETE " + relation.update?.toUpperCase().replace(/-/g, " ") : "";
    name = (parent + "_" + name).toLowerCase();
    return `${pad}CONSTRAINT ${name} FOREIGN KEY (${relation.join}) REFERENCES ${relation.target} (id)${da}${ua},\n`;
  }

  // Constraint generator
  static createConstraint(_dbType: string, parent: string, constraint: Constraint, padWidth = 4): string {
    const pad = "".padEnd(padWidth), simple = typeof constraint === "string";
    const name = simple ? undefined : (parent + "_" + constraint.name).toLowerCase();
    const expr = simple ? constraint : constraint.check;
    return `${pad}${name ? "CONSTRAINT " + name + " " : ""}CHECK (${expr}),\n`;
  }

  // Uses the most standard MySQL syntax and then it is fixed afterwards
  static createTable(schema: Schema, dbType = "mysql", nameOverride?: string): string {
    // Get name padding
    const namePad = Math.max(...Object.keys(schema.properties).map((n) => n.length || 0)) + 1;

    // Check with if type is SQLite since it is the most restrictive
    const sqlite = dbType === "sqlite", postgres = dbType === "postgres", other = sqlite || postgres;

    // Create SQL
    const table = nameOverride ?? schema.name;
    const columns = Object.entries(schema.properties).map(([n, c]) => this.createColumn(dbType, n, c!, namePad)).join("");
    const indices = !other && schema.indices?.map((i) => this.createIndex(dbType, i)).join("") || "";
    const relations = !sqlite && Object.entries(schema.relations || []).map(([n, r]) => this.createRelation(dbType, schema.name, n, r!)).join("") || "";
    const constraints = !sqlite && (schema.constraints || []).map((c) => this.createConstraint(dbType, schema.name, c)).join("") || "";

    // Create sql
    let sql = `CREATE TABLE IF NOT EXISTS ${table} (\n${columns}${indices}${relations}${constraints})`;

    // Independent indexes
    if (other && schema.indices) sql += "\n" + schema.indices?.map((i) => i.fulltext ? "" : this.createIndex(dbType, i, 0, table)).join("");

    const fixDanglingComma = (sql: string) => sql.replace(/,\n\)/, "\n);");
    sql = fixDanglingComma(postgres ? this.postgres(sql) : sql);

    return sql;
  }

  static postgres(sql: string) {
    return sql.replace(/(DATETIME)|(INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT)|(JSON_EXTRACT)|(RLIKE)/g, (m: string) => {
      if (m === "DATETIME") return "TIMESTAMP";
      if (m === "INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT") return "SERIAL";
      if (m === "JSON_EXTRACT") return "JSON_EXTRACT_PATH";
      if (m === "RLIKE") return "~*";
      return m;
    });
  }
}
