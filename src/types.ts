// Copied from base util.ts which are copied from type-fest
export type Primitive = bigint | boolean | Date | null | number | string | Uint8Array | undefined;
export type Parameter = Primitive | bigint[] | boolean[] | Date[] | number[] | string[];

export type Class<T> = { new (): T };
export type Row = { [key in string]?: unknown };
export type Identifiable = { id?: number };

// JSON Schema Property
export interface Property {
  comment?: string;
  default?: unknown;
  format?: string;
  maxLength?: number;
  minLength?: number;
  pattern?: string;
  required?: boolean;
  readOnly?: boolean;
  unique?: boolean;
  type: "boolean" | "date" | "integer" | "number" | "json" | "string";
  writeOnly?: boolean;
}

// JSON Schema Extensions Properties
export interface Column extends Property {
  asExpression?: string | { [key: string]: string };
  comment?: string;
  dateOn?: "delete" | "insert" | "update";
  generatedType?: string | "virtual" | "stored";
  primaryKey?: boolean;
}

export interface Index {
  array?: number;
  comment?: string;
  properties: string[];
  fulltext?: boolean;
  name?: string;
  unique?: boolean;
}

export interface Relation {
  join: string;
  target: string;
  type: "many-to-one" | "many-to-many";
}

export type Constraint = string | { name?: string; check: string; enforced?: boolean; comment?: string };

export interface Schema {
  name: string;
  properties: { [key: string]: Column };
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
