// Copied from base util.ts which are copied from type-fest
export type Primitive = bigint | boolean | Date | null | number | string | Uint8Array | undefined;
export type Parameter = Primitive | bigint[] | boolean[] | Date[] | number[] | string[];

export type Class<T> = { new (): T };
export type Row = { [key in string]?: unknown };
export type Identifiable = { id?: number | string };

// JSON Schema Property
// See https://json-schema.org/understanding-json-schema/keywords#items
export interface Property {
  default?: unknown;
  description?: string;
  format?: string;
  maxLength?: number;
  maximum?: number | string;
  minLength?: number;
  minimum?: number | string;
  pattern?: string;
  readOnly?: boolean;
  uniqueItems?: boolean;
  type: "boolean" | "date" | "integer" | "number" | "object" | "string";
  writeOnly?: boolean;
}

// JSON Schema Extensions Properties
export interface Column extends Property {
  as?: string | { [key: string]: string };
  dateOn?: "delete" | "insert" | "update";
  index?: boolean;
  primaryKey?: boolean;
}

// Extra properties such as `array`, 'subType' and 'unique can only be defined externally
// (i.e. not through the TS file)
export interface Index {
  array?: number;
  description?: string;
  properties: string[];
  subType?: string;
  unique?: boolean;
}

// Relations can only be described externally
export interface Relation {
  join: string;
  delete?: "cascade" | "no-action" | "restrict" | "set-default" | "set-null";
  update?: "cascade" | "no-action" | "restrict" | "set-default" | "set-null";
  target: string;
  type: "many-to-one" | "many-to-many";
}

export type Constraint = { name?: string; check: string; enforced?: boolean; comment?: string; provider?: string };

export interface Schema {
  // Name of relation, normally the table name (if it does not exist the class name will be used)
  table?: string;
  // Type of the object, which should correspond to the entity name (i.e. class)
  type?: string;
  // Map of properties
  properties: { [key: string]: Column };
  required?: string[];
  fullText?: string[];
  indices?: Index[];
  relations?: { [key: string]: Relation };
  constraints?: Constraint[];
}

export type Predicate<PT> = {
  eq?: PT | null;
  neq?: PT | null;
  gt?: PT;
  gte?: PT;
  lt?: PT;
  lte?: PT;
  in?: PT[];
  nin?: PT[];
  contains?: string;
  match?: string;
  between?: [PT, PT];
  exists?: boolean;
};

export type ShortHand = boolean | Date | number | string;

export type Condition<T> = {
  [P in Extract<keyof T, string>]?: Predicate<T[P]> | (T[P] & ShortHand) | null;
};

export type Where<T> = Condition<T> | AndClause<T> | OrClause<T> | { $sql: string };

export interface AndClause<T> {
  and: Where<T>[];
}

export interface OrClause<T> {
  or: Where<T>[];
}

export type Order<T> = Partial<{ [P in keyof T & "created" & "updated"]: ("ASC" | "DESC") }>;

export interface Filter<T> {
  where?: Where<T>;
  select?: Extract<keyof T, string>[];
  order?: Order<T>;
  limit?: number;
  offset?: number;
}
