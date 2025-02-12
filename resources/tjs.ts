#!/usr/bin/env -S deno run -A

// Example of invoking TypeScript JSON Schema

import * as TJS from "npm:typescript-json-schema";
import { DDL, type Schema } from "../mod.ts";

// See https://github.com/YousefED/typescript-json-schema/issues/251
const settings: TJS.PartialArgs = { required: true, defaultNumberType: "integer", ignoreErrors: true, validationKeywords: DDL.EXTENSIONS };
const compilerOptions = { lib: [ "es2020" ], target: "es2020" };
const program = TJS.getProgramFromFiles([ import.meta.dirname! + "/account.ts" ], compilerOptions);

// We can either get the schema for one file and one type...
const schema = DDL.cleanSchema(TJS.generateSchema(program, "Account", settings) as Schema);
console.info(schema);
