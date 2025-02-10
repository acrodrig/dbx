const KV = await Deno.openKv();

export type Identifiable = {
  id: string;
  __versionstamp?: string;
};

class Repository<T extends Identifiable> {
  table: string;
  type: { new (): T };

  constructor(type: { new (): T }, name?: string) {
    this.type = type;
    this.table = name ?? type.name;
  }

  // https://docs.deno.com/kv/manual/operations#list
  async all(limit = 10, debug = false): Promise<T[]> {
    if (debug) console.debug({ method: "all" });
    const entries = KV.list({ prefix: [this.table] });
    const records = [];
    for await (const e of entries) {
      records.push(e.value);
      if (records.length >= limit) break;
    }
    return records.map((r) => this.fromRecord(r as Record<string, unknown>, new this.type()));
  }

  // https://docs.deno.com/kv/manual/operations#delete
  // async delete<T>(where: Where<T>, debug = false): Promise<number>;

  // https://docs.deno.com/kv/manual/operations#delete
  async deleteById(id: string, debug = false): Promise<boolean> {
    if (debug) console.debug({ method: "delete", id });
    await KV.delete([this.table, id]);
    return true;
  }

  // https://dev.mysql.com/doc/refman/8.0/en/select.html
  // Follow Loopback model (see https://loopback.io/doc/en/lb4/Querying-data.html)
  // TODO: For now all queries return all values
  find(filter: Record<string, unknown> = {}, debug = false): Promise<T[]> {
    if (debug) console.debug({ method: "find", filter });
    return this.all();
  }

  // https://docs.deno.com/kv/manual/operations#get
  async findById(id: string, debug = false): Promise<T | undefined> {
    if (debug) console.debug({ method: "findById", id });
    const entry = await KV.get([this.table, id]);
    if (!entry) return undefined;
    return this.fromRecord(entry.value as Record<string, unknown>, new this.type());
  }

  // https://docs.deno.com/kv/manual/operations#list
  async findOne(filter: Record<string, unknown> = {}, debug = false): Promise<T | undefined> {
    if (debug) console.debug({ method: "findOne", filter });
    return (await this.all(1))?.pop();
  }

  // https://docs.deno.com/kv/manual/operations#set
  async insert(object: T, debug = false): Promise<T> {
    if (debug) console.debug({ method: "insert", object });
    const cr = await KV.set([this.table, object.id], object);
    object.__versionstamp = cr.versionstamp;
    return object;
  }

  // https://docs.deno.com/kv/manual/operations#set
  async update(object: Pick<T, "id"> & Partial<T>, debug = false): Promise<T | undefined> {
    if (debug) console.debug({ method: "update", object });
    const cr = await KV.set([this.table, object.id], object);
    object.__versionstamp = cr.versionstamp;
    return object as T;
  }

  // https://docs.deno.com/kv/manual/operations#set
  async upsert(object: Pick<T, "id"> & Partial<T>, debug = false): Promise<T | undefined> {
    if (debug) console.debug({ method: "upsert", object });
    const cr = await KV.set([this.table, object.id], object);
    object.__versionstamp = cr.versionstamp;
    return object as T;
  }

  toRecord(object: Partial<T>, _record: Record<string, unknown> = {}): Record<string, unknown> {
    return object;
  }

  // No-op for now
  fromRecord(record: Record<string, unknown>, _object: { [key in string]?: unknown } = {}): T {
    return record as T;
  }
}

export class DB {
  static getRepo<T extends Identifiable>(type: { new (): T }): Repository<T> {
    return new Repository<T>(type);
  }
}

export default DB;
