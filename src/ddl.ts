import { eTag } from "@std/http/etag";
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
    etag: { type: "string", maxLength: 1024, description: "Possible ETag for all resources that are external. Allows for better synch-ing." },
    inserted: { type: "date", dateOn: "insert", index: ["inserted"], description: "Timestamp when current record is inserted" },
    updated: { type: "date", dateOn: "update", index: ["updated"], description: "Timestamp when current record is updated" },
  },
};

export class DDL {
  static EXTENSIONS = ["as", "constraint", "dateOn", "fullText", "index", "primaryKey", "relations", "unique", "table"];
  static TS_OPTIONS = { lib: ["es2022"], module: "es2022", target: "es2022" };
  static TJS_OPTIONS = { required: true, ignoreErrors: true, defaultNumberType: "integer", validationKeywords: DDL.EXTENSIONS };

  static padWidth = 4;
  static defaultWidth = 128;
  static textWidth = 2048;

  /**
   * Generator function that creates a map of schemas from class files
   * @param classFiles - a map of class names to file paths
   * @param base - the base directory where the files are located
   * @param extensions - additional extensions to be used by the generator
   * @example
   *
   * Below is an example of how to define the generator function using :
   *
   * ```ts
   * DDL.generator = async function(classFiles: Record<string, string>, base?: string) {
   *   const TJS = (await import("npm:typescript-json-schema@0.65.1")).default;
   *   const program = TJS.getProgramFromFiles(Object.values(classFiles), DDL.TS_OPTIONS, base);
   *   const entries = Object.keys(classFiles).map((c) => [c, TJS.generateSchema(program, c, DDL.TJS_OPTIONS)]);
   *   return Object.fromEntries(entries);
   * };
   * ```
   */
  static generator: (classFiles: Record<string, string>, base?: string, extensions?: string[]) => Promise<Record<string, Schema>>;

  static async ensureSchemas(
    schemas: Record<string, Schema>,
    classFiles: Record<string, string>,
    base?: string,
    enhance = false,
    schemasFile?: string,
  ): Promise<Record<string, Schema>> {
    const outdated = !schemas ? undefined : await DDL.outdatedSchemas(schemas, base);
    if (!outdated || outdated.length > 0) return schemas;

    // Generate and save
    schemas = await DDL.generateSchemas(classFiles, base, enhance);
    if (schemasFile) await Deno.writeTextFile(schemasFile, JSON.stringify(schemas, null, 2));
    return schemas;
  }

  /**
   * Generate schemas from class files
   *
   * @param classFiles - a map of class names to file paths
   * @param base - the base directory where the files are located, needed for relative URLs in schema
   * @param enhance - if true schemas will be enhanced with standard properties
   * @returns a map of class names to schemas
   */
  static async generateSchemas(classFiles: Record<string, string>, base?: string, enhance?: boolean): Promise<Record<string, Schema>> {
    // If DDL has no generator, throw an error
    if (!DDL.generator) throw new Error("DDL.generator must be set to a function that generates schemas from class files");

    // Generate schemas and clean them and enhance them
    const schemas = await DDL.generator(classFiles, base);
    for (const [c, f] of Object.entries(classFiles)) {
      const etag = await eTag(await Deno.stat(f));
      const file = f.startsWith("/") ? f : "./" + f;
      schemas[c] = DDL.#cleanSchema(schemas[c], c, undefined, "file://" + file, etag);
      if (enhance) schemas[c] = DDL.enhanceSchema(schemas[c]);
    }

    // Return schema map (from class/type to schema)
    return schemas;
  }

  /**
   * When using tools such as [TJS](https://github.com/YousefED/typescript-json-schema) to
   * generate JSON schemas from TypeScript classes, the resulting schema may need some
   * cleaning up. This function does that.
   *
   * @param schema - the tool-generated schema
   * @param type - the type of the schema which we may need to correct/override
   * @param table - the table name which we may need to correct/override
   * @param $id - the URL of the schema file
   * @param etag - the etag of the source file
   */
  static #cleanSchema(schema: Schema, type?: string, table?: string, $id?: string, etag?: string): Schema {
    if (type) schema.type = type;
    if (table) schema.table = table;

    // By default the table name is the same as the type name
    if (!schema.table) schema.table = type?.toLowerCase() ?? schema.type?.toLowerCase();

    // Set $id to the file URL of the schema and the date time it was created (as the hash)
    if ($id) schema.$id = $id + ($id.includes("#") ? "" : "#" + new Date().toISOString().substring(0, 19));

    // Generate an etag (based on the file etag)
    if (etag) schema.etag = etag;

    if (typeof (schema.fullText) === "string") schema.fullText = (schema.fullText as string).split(",").map((s) => s.trim());
    Object.entries(schema.properties).forEach(([n, c]) => {
      // If 'description' spans multiple lines, use the first line as the description
      if (c.description?.includes("\n")) c.description = c.description.split("\n")[0];

      // If there is no type, assume it is a string
      if (!c.type) c.type = "string";

      // Make primary key and uniqye attributes boolean
      if (typeof c.primaryKey === "string") c.primaryKey = true;
      if (typeof c.unique === "string") c.unique = true;

      // Use the format as a way to discover a date type
      if (c.format === "date-time") c.type = "date";

      // Build the index into a proper string array
      if (typeof c.index === "string") c.index = (c.index ? c.index : n).split(",").map((s) => s.trim());
    });
    return schema;
  }

  static async outdatedSchemas(schemas: Record<string, Schema>, base = ""): Promise<string[]> {
    const outdated: string[] = [];
    for (const [c, s] of Object.entries(schemas)) {
      if (!(await DDL.outdatedSchema(s, base))) continue;
      outdated.push(c);
    }
    return outdated;
  }

  /**
   * Check if the schema is outdated by comparing the etag with the content etag
   * Returns the file if it is outdated, or undefined if it is not.
   * @param schema - the schema to check
   * @param base - the directory where the schema file is located
   */
  static async outdatedSchema(schema: Schema, base = ""): Promise<boolean> {
    if (!base.startsWith("/")) throw new Error("Base must be absolute within the system");
    if (!schema.$id) throw new Error("Schema must have an '$id' property to test if it is outdated");

    // Get file and schema create date from $id
    const url = new URL(schema.$id);
    const file = ((schema.$id.startsWith("file://./") ? base : "") + url.pathname).replace(/\/\//g, "/");
    const fileInfo = await Deno.stat(file);
    const schemaDate = url.hash.substring(1);

    // First compare dates
    const fileDate = fileInfo.mtime!.toISOString().substring(0, 19);
    // console.log(url.pathname, " --- ", schemaDate, " : ", fileDate, " -> ", schemaDate < fileInfo.mtime!.toISOString());
    if (schemaDate < fileDate) return true;

    // If the date comparison is not enough to tell, then compare etags
    const etag = await eTag(await Deno.stat(file));
    return schema.etag !== etag;
  }

  // Enhance schema with standard properties
  static enhanceSchema(schema: Schema, selected: string[] = ["id", "inserted", "updated"]): Schema {
    // Select properties that match the selected columns and add them to the schema
    if (!schema.properties) schema.properties = {};
    for (const name of selected) {
      if (schema.properties[name]) continue;
      schema.properties[name] = _BaseSchema.properties[name];
    }
    return schema;
  }

  static #defaultValue(column: Column, dbType: string) {
    const cd = column.default;

    // Automatically inserted/updated values
    if (column.dateOn === "insert") return "CURRENT_TIMESTAMP";
    if (column.dateOn === "update") return "CURRENT_TIMESTAMP" + ((dbType !== DB.Provider.MYSQL) ? "" : " ON UPDATE CURRENT_TIMESTAMP");

    // Generated fields should NOT have a default value
    if (column.as) return undefined;

    // Respect object defaults as well as auto-quote strings
    if (typeof cd === "string" && cd.startsWith("('") && cd.endsWith("')")) return cd;
    if (typeof cd === "string" && !cd.startsWith("'") && !cd.endsWith("'")) return "'" + cd + "'";
    if (typeof cd === "object") return "('" + JSON.stringify(cd) + "')";

    return cd;
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
    const dv = this.#defaultValue(column, dbType);
    // const def = Object.hasOwn(column, "default") || Object.hasOwn(column, "dateOn") ? " DEFAULT " + this.#defaultValue(column, dbType) : "";
    const key = primaryKey ? " PRIMARY KEY" : (column.unique !== undefined ? " UNIQUE" : "");
    const comment = (dbType === DB.Provider.MYSQL) && column.description ? " COMMENT '" + column.description.replace(/'/g, "''") + "'" : "";

    // Correct Postgres JSON type
    if (dbType === DB.Provider.POSTGRES && type === "JSON") type = "JSONB";
    if (dbType === DB.Provider.POSTGRES && autoIncrement) type = "SERIAL";

    return `${pad}${name.padEnd(namePad)}${type}${length}${nullable}${as}${dv ? " DEFAULT " + dv : ""}${key}${gen}${comment},\n`;
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
  static createColumnConstraint(dbType: string, parent: string, name: string, column: Column, padWidth = 4): string {
    const pad = "".padEnd(padWidth);
    const value = (v: number | string) => typeof v === "string" ? "'" + v + "'" : v;
    let expr = "";
    if (column.constraint) expr = column.constraint;
    else if (column.maximum) expr += `${name} >= ${value(column.maximum)}`;
    else if (column.minimum) expr += `${name} >= ${value(column.minimum)}`;
    name = parent + "_" + name;
    return expr ? `${pad}${name && dbType !== "sqlite" ? "CONSTRAINT " + name + " " : ""}CHECK (${expr}),\n` : "";
  }

  // Constraint independent generator
  static createIndependentConstraint(dbType: string, parent: string, constraint: Constraint, padWidth = 4): string {
    const pad = "".padEnd(padWidth), simple = typeof constraint === "string";
    const name = simple ? undefined : (parent + "_" + constraint.name).toLowerCase();
    const expr = simple ? constraint : constraint.check;
    return `${pad}${name && dbType !== "sqlite" ? "CONSTRAINT " + name + " " : ""}CHECK (${expr}),\n`;
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

    // Create constraints (and sort lines for consistency)
    const filter = (c: Constraint) => !c.provider || c.provider === dbType;
    const columnConstraints = Object.entries(schema.properties || {}).map(([n, c]) => this.createColumnConstraint(dbType, table, n, c));
    const independentConstraints = (schema.constraints || []).filter(filter).map((c) => this.createIndependentConstraint(dbType, table, c));
    const constraints = [...columnConstraints, ...independentConstraints].sort().join("");

    // Create sql
    let sql = `CREATE TABLE IF NOT EXISTS ${table} (\n${columns}${relations}${constraints})`;

    // Independent indexes (and sort lines for consistency)
    const indices = schema.indices?.slice() ?? [];
    Object.values(schema.properties).forEach((c) => {
      if (!c.index?.length) return;
      const types = c.index!.map((n) => schema.properties[n].type);
      const array = types.includes("array") ? types.indexOf("array") : undefined;
      indices!.push({ properties: c.index!, array });
    });
    if (indices.length) sql += "\n" + indices?.map((i) => this.createIndex(dbType, i, 0, table)).sort().join("");

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
      if (m === "REGEXP") return "~*";
      return m;
    });
  }
}
