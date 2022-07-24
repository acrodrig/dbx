import { Column, Constraint, Index, Relation, Schema } from "./types.ts";
import DB from "./db.ts";


const dataTypes = {
    boolean: "BOOLEAN",
    date:    "DATETIME",
    integer: "INTEGER",
    json:    "JSON",
    number:  "DOUBLE",
    string:  "VARCHAR",
}

export class DDL {

    static padWidth = 4;
    static defaultWidth = 256;

    // Uses the most standard MySQL syntax and then it is fixed afterwards
    static createTable(schema: Schema, dbType = "mysql", nameOverride?: string): string {
        // Get name padding
        const namePad = Math.max(...Object.keys(schema.properties).map(n => n.length || 0)) + 1;

        // Check with if type is SQLite since it is the most restrictive
        const sqlite = (dbType === "sqlite"), postgres = (dbType === "postgres"), other = sqlite || postgres;

        // Column generator
        const createColumn =  function(name: string, column: Column, padWidth = DDL.padWidth, defaultWidth = DDL.defaultWidth): string {
            if (typeof(column.default) === "object") column.default = "('"+JSON.stringify(column.default)+"')";
            if (column.dateOn === "insert") column.default = "CURRENT_TIMESTAMP";
            if (column.dateOn === "update") column.default = "CURRENT_TIMESTAMP"+(other ? "" : " ON UPDATE CURRENT_TIMESTAMP");
            const pad = "".padEnd(padWidth);
            const type = dataTypes[column.type as keyof typeof dataTypes];
            const autoIncrement = column.primaryKey && column.type === "integer";
            const length = type.endsWith("CHAR") ? "("+(column.maxLength || defaultWidth)+")" : "";
            const nullable = column.primaryKey || column.required ? " NOT NULL" : "";
            const gen = autoIncrement ? (sqlite ? " AUTOINCREMENT" : " AUTO_INCREMENT") : "";
            const asExpression = column.asExpression && (typeof column.asExpression === "string" ? DB._sqlFilter(column.asExpression) : column.asExpression[dbType]);
            const as = asExpression ? " AS ("+asExpression+") "+(column.generatedType?.toUpperCase() || "VIRTUAL") : "";
            const def = Object.hasOwn(column, "default") ? " DEFAULT "+column.default:"";
            const key = column.primaryKey ? " PRIMARY KEY" : (column.unique ? " UNIQUE" : "");
            const comment = !other && column.comment ? " COMMENT '"+column.comment.replace(/'/g, "''")+"'" : "";
            return `${pad}${name.padEnd(namePad)}${type}${length}${nullable}${as}${def}${key}${gen}${comment},\n`;
        }

        // Index generator
        // If we pass a table name it will create an independent expression
        const createIndex = function(indice: Index, padWidth = 4, table?: string): string {
            const pad = "".padEnd(padWidth);
            const columns = [...indice.properties] as string[];
            const key = indice.fulltext ? "FULLTEXT" : "INDEX";
            const ine = table ? " IF NOT EXISTS" : "";
            const end = table ? ";" : ",";

            // If there is an array expression, replace the column by it
            // TODO: multivalued indexes only supported on MYSQL for now
            if (!other && indice.array !== undefined) columns[indice.array] = "(CAST("+columns[indice.array]+" AS UNSIGNED ARRAY))";

            return `${pad}${table ? "CREATE " : ""}${indice.unique ? "UNIQUE " : ""}${key}${ine} ${table ? table+"_" : ""}${indice.name ?? ""}${table ? " ON "+table : ""} (${columns.join(",")})${end}\n`;
        }

        // Relation generator
        const createRelation = function(parent: string, name: string, relation: Relation, padWidth = 4): string {
            const pad = "".padEnd(padWidth);
            name = (parent+"_"+name).toLowerCase();
            return `${pad}CONSTRAINT ${name} FOREIGN KEY (${relation.join}) REFERENCES ${relation.target} (id),\n`;
        }

        // Constraint generator
        const createConstraint = function(parent: string, constraint: Constraint, padWidth = 4): string {
            const pad = "".padEnd(padWidth), simple = typeof(constraint) === "string";
            const name = simple ? undefined : (parent+"_"+constraint.name).toLowerCase();
            const expr = simple ? constraint : constraint.check;
            return `${pad}${name ? "CONSTRAINT "+name+" " : ""}CHECK (${expr}),\n`;
        };

        // Create SQL
        const table = nameOverride ?? schema.name;
        const columns = Object.entries(schema.properties).map(([n,c]) => createColumn(n, c!)).join("");
        const indices = !other && schema.indices?.map(i => createIndex(i)).join("") || "";
        const relations = !sqlite && Object.entries(schema.relations || []).map(([n, r]) => createRelation(schema.name, n, r!)).join("") || "";
        const constraints = !sqlite && (schema.constraints || []).map(c => createConstraint(schema.name, c)).join("") || "";

        // Create sql
        let sql = `CREATE TABLE IF NOT EXISTS ${table} (\n${columns}${indices}${relations}${constraints})`;

        // Independent indexes
        if (other && schema.indices) sql += "\n"+schema.indices?.map(i => i.fulltext ? "" : createIndex(i, 0, table)).join("");

        const fixDanglingComma = (sql: string) => sql.replace(/,\n\)/, "\n);");
        sql = fixDanglingComma(postgres ? this.postgres(sql) : sql);

        return sql;
    }

    static postgres(sql: string) {
        return sql.replace(/(DATETIME)|(INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT)|(RLIKE)/g, (m: string) => {
            switch (m) {
                case "DATETIME": return "TIMESTAMP";
                case "INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT": return "SERIAL";
                case "RLIKE": return "~*";
            }
            return m;
        });

    }
}
