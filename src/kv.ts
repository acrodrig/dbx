import type { Class, Filter, Identifiable, Schema, Where } from "./types.ts";
import { Repository } from "./repository.ts";

const META = false;
const kv = await Deno.openKv();

export class KV<T extends Identifiable> extends Repository<T> {

  constructor(type: Class<T>, private keys: string[], schema?: Schema, name?: string) {
    super(type, schema, name);
  }

  async #auto(): Promise<number> {
    const key = [this.type.name + "$auto"];
    const auto = await kv.get<number>(key);
    const incr = (auto.value ?? 0) + 1;
    await kv.atomic().check(auto).set(key, incr).commit();
    return incr;
  }

  #build(r: Partial<T>): T {
    return (typeof this.type === "string" ? r : Object.assign(new this.type(), r)) as T;
  }

  async #delete(key: Deno.KvKey, check = true) {
    if (!check) return await kv.delete(key) as undefined;
    const entry = await kv.get<T>(key);
    if (!entry) return undefined;
    await kv.delete(key);
    return entry.value;
  }

  async #deleteMany(key: Deno.KvKey = [], s?: string, e?: string, check = true): Promise<(T | undefined)[]> {
    key = [this.type.name];
    const entries = this.#list(key, s, e);
    // TODO: Parallelize?
    const values: (T | undefined)[] = [];
    for await (const e of entries) {
      const value = await this.#delete(e.key as string[], check);
      values.push(this.#build(value as Partial<T>));
    }
    return values;
  }

  #list(key: Deno.KvKey = [], s?: string, e?: string) {
    return kv.list<T>({ prefix: key, start: s ? key.concat(s) : undefined, end: e ? key.concat(e) : undefined });
  }

  async #update(key: Deno.KvKey = [], object: Partial<T>): Promise<T | undefined> {
    const entry = await kv.get<T>(key);
    const insertedAt = (entry.value as any)?.insertedAt ?? new Date();
    if (META) object = Object.assign(object, { insertedAt, updatedAt: new Date() });
    await kv.set(key, Object.assign(entry.value ?? {}, object));
    return this.#build(object);
  }

  // https://docs.deno.com/kv/manual/operations#list
  override all(_debug = false): Promise<T[]> {
    throw new Error("Method not implemented.");
  }

  override async count(where?: Where<T>, debug?: boolean): Promise<number> {
    if (where) throw new Error("Method not implemented.");
    if (debug) console.debug({ method: "count", key: [] });
    let count = 0;
    const key = [this.type.name];
    const entries = this.#list(key);
    for await (const _e of entries) count += 1;
    return count;
  }

  // https://docs.deno.com/kv/manual/operations#delete
  override async delete<T>(where?: Where<T>, debug?: boolean): Promise<number> {
    if (where) throw new Error("Method not implemented.");
    if (debug) console.debug({ method: "delete", key: [] });
    return (await this.#deleteMany())?.length ?? 0;
  }

  // https://docs.deno.com/kv/manual/operations#delete
  override async deleteById(id: number | string, debug?: boolean, check = true): Promise<boolean> {
    const key = [this.type.name, id];
    if (debug) console.debug({ method: "deleteById", key });
    const value = await this.#delete(key, check);
    return value !== undefined;
  }

  // https://docs.deno.com/kv/manual/operations#list
  override async find(_filter: Filter<T> = {}, debug?: boolean): Promise<T[]> {
    // TODO: not using filter, need to extract keys and start/end if given
    const key = [this.type.name];
    const entries = this.#list(key);
    const values: T[] = [];
    if (debug) console.debug({ method: "find", key });
    for await (const e of entries) {
      values.push(this.#build(e.value as Partial<T>));
    }
    return values;
  }

  // https://docs.deno.com/kv/manual/operations#get
  override async findById(id: number | string, debug?: boolean): Promise<T | undefined> {
    const key = [this.type.name, id];
    if (debug) console.debug({ method: "findById", key });
    const entry = await kv.get<T>(key);
    return entry && entry.value ? this.#build(entry.value) : undefined;
  }

  // https://docs.deno.com/kv/manual/operations#list
  override findOne(_filter: Filter<T> = {}, _debug?: boolean): Promise<T | undefined> {
    throw new Error("Method not implemented.");
  }

  // https://docs.deno.com/kv/manual/operations#set
  override async insert(object: T, debug?: boolean, check = true): Promise<T> {
    const key = [this.type.name, ...this.keys.map((k) => (object as any)[k] as string)];
    if (check) {
      const entry = await kv.get(key);
      if (entry && entry.value) throw new Error(`Key ${key} already exists`);
    }
    if (!object.id) object.id = await this.#auto();
    if (META) object = Object.assign(object, { insertedAt: new Date(), updatedAt: new Date() }) as T;
    if (debug) console.debug({ method: "insert", key, object });
    await kv.set(key, object);
    return object;
  }

  // https://docs.deno.com/kv/manual/operations#set
  override update(object: Partial<T>, debug?: boolean): Promise<T | undefined> {
    const key = [this.type.name, ...this.keys.map((k) => (object as any)[k] as string)];
    if (debug) console.debug({ method: "update", key, object });
    return this.#update(key, object);
  }

  // https://docs.deno.com/kv/manual/operations#set
  override updateById(id: number | string, object: Partial<T>, debug = false): Promise<T | undefined> {
    const key = [this.type.name, id];
    if (debug) console.debug({ method: "updateById", key, object });
    return this.#update(key, object);
  }
}
