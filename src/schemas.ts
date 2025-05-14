import { eTag } from "@std/http/etag";
import { hub } from "hub";
import { BaseSchema } from "./ddl.ts";
import type { Schema } from "./types.ts";

const log = hub("dbx:schema");

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
 * async function generator (classFiles: Record<string, string>, base?: string) {
 *   const TJS = (await import("npm:typescript-json-schema@0.65.1")).default;
 *   const program = TJS.getProgramFromFiles(Object.values(classFiles), Generator.TS_OPTIONS, base);
 *   const entries = Object.keys(classFiles).map((c) => [c, TJS.generateSchema(program, c, Generator.TJS_OPTIONS)]);
 *   return Object.fromEntries(entries);
 * };
 * ```
 */

type Generator = (classFiles: Record<string, string>, base?: string, extensions?: string[]) => Promise<Record<string, Schema>>;

export class Schemas {
  static EXTENSIONS = ["as", "constraint", "dateOn", "fullText", "index", "primaryKey", "relations", "unique", "table"];
  static TS_OPTIONS = { lib: ["es2022"], module: "es2022", target: "es2022" };
  static TJS_OPTIONS = { required: true, ignoreErrors: true, defaultNumberType: "integer", validationKeywords: Schemas.EXTENSIONS };

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
  static #clean(schema: Schema, type?: string, table?: string, $id?: string, etag?: string): Schema {
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

  static async ensure(
    schemas: Record<string, Schema>,
    classFiles: Record<string, string>,
    generator: Generator,
    base?: string,
    enhance = false,
    schemasFile?: string,
  ): Promise<Record<string, Schema>> {
    const outdated = !schemas ? undefined : await Schemas.outdatedSchemas(schemas, base);
    if (!outdated || outdated.length > 0) return schemas;

    // Generate and save
    schemas = await Schemas.generate(classFiles, generator, base, enhance);
    if (schemasFile) await Deno.writeTextFile(schemasFile, JSON.stringify(schemas, null, 2));
    return schemas;
  }

  /**
   * Generate schemas from class files
   *
   * @param classFiles - a map of class names to file paths
   * @param generator - generate AST tree
   * @param base - the base directory where the files are located, needed for relative URLs in schema
   * @param enhance - if true schemas will be enhanced with standard properties
   * @returns a map of class names to schemas
   */
  static async generate(classFiles: Record<string, string>, generator: Generator, base?: string, enhance?: boolean): Promise<Record<string, Schema>> {
    log.debug({ method: "generateSchemas", classFiles, base, enhance });

    // If Generator has no generator, throw an error
    if (!generator) throw new Error("Generator must be set to a function that generates schemas from class files");

    // Generate schemas and clean them and enhance them
    const schemas = await generator(classFiles, base);
    for (const [c, f] of Object.entries(classFiles)) {
      const etag = await eTag(await Deno.stat(f));
      const file = f.startsWith("/") ? f : "./" + f;
      schemas[c] = Schemas.#clean(schemas[c], c, undefined, "file://" + file, etag);
      if (enhance) schemas[c] = Schemas.enhance(schemas[c]);
    }

    // Return schema map (from class/type to schema)
    return schemas;
  }

  static async outdatedSchemas(schemas: Record<string, Schema>, base = ""): Promise<string[]> {
    const outdated: string[] = [];
    for (const [c, s] of Object.entries(schemas)) {
      if (!(await Schemas.outdated(s, base))) continue;
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
  static async outdated(schema: Schema, base = ""): Promise<boolean> {
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
  static enhance(schema: Schema, selected: string[] = ["id", "inserted", "updated"]): Schema {
    // Select properties that match the selected columns and add them to the schema
    if (!schema.properties) schema.properties = {};
    for (const name of selected) {
      if (schema.properties[name]) continue;
      schema.properties[name] = BaseSchema.properties[name];
    }
    return schema;
  }
}
