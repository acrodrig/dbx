# DBX

> 🚧 Beta code for the moment. Tread carefully.

DBX is a simple, [Deno](https://deno.land/)-specific, minimalist library for accessing databases (MongoDB support 
coming in the future). After years of working with Loopback, Knex, TypeORM and a short stop on DenoDB
I decided that things could be made simpler (yes, I [know how standards proliferate](https://imgs.xkcd.com/comics/standards.png), sigh).



## Tenets:

- Everything should be as simple as possible (but not simpler)
- Provide a thin layer on top of SQL to support common cases (80%), and SQL for the complex rest (20%)
- Use existing standards for describing schemas (such as [JSON schema](https://json-schema.org)) instead of inventing another (looking at you Prisma)
- Make good use of "newish" (or at least newly implemented in MYSQL) DB features such as constraint checks
- Prefer [DataMapper](https://typeorm.io/active-record-data-mapper#what-is-the-data-mapper-pattern) to [ActiveRecord](https://typeorm.io/active-record-data-mapper#what-is-the-active-record-pattern) ("leave my classes alone")


## Uses

### Simple Use

Quickly start using without schema/configuration:

```typescript
import DB from "jsr:@acr/dbx";

// Class will be stored in a table with an auto increment ID
class User {
    id!: number;
    email?: string;
    name: string;
    age?: number;
    preferences: { [key: string]: boolean|number|string; } = { wrap: true, minAge: 18 };

    constructor(data?: Pick<User, "name"> & Partial<User>) {
        Object.assign(this, data);
    }
}

// Create a user
const repo = await DB.getRepository(User);
let user = new User({ name: "John Smith", age: 33 });
assert(user.id === undefined); // User has no ID

// Save
user = await repo.insert(user);
assert(user.id); // User has been assigned an ID

// Retrieve by ID
const userId = user.id;
user = await repo.findById(userId);
assert(user); // User was retrieved by ID

// JSON is retrieved correctly
assert(user.preferences.minAge === 18);

// Retrieve by filter (heaviliy inspired in TypeORM)
users = await repo.find({ where: { name: "John Smith", and: [ { age: { gt: 18 } }, { age: { lt: 100 } } ] }, order: { age: "DESC" }, limit: 1 });
assert(users.length === 1); // User was found

// Retrieve by arbitrary combination of JSON and SQL (equivalent to previous query)
users = await repo.find({ where: { name: "John Smith", $sql: "age > 18 AND age < 100" }, order: { age: "DESC" }, limit: 1 });
assert(users.length === 1); // User was found

// Or just use SQL ...
const users = await DB.query(`SELECT * FROM User WHERE name = :name AND age > :minAge AND age < :maxAge`, {  name: "John Smith", minAge: 18, maxAge: 100 });
assert(users.length === 1); // User was found
```

### Using with an (extended) JSON schema

DBX extends JSON Schema (along [these](https://json-schema.org/understanding-json-schema/structuring.html#id21) lines) to 
provide a way to define the database schema (see specific extensions in the [`types.ts`](./src/types.ts) file). With a schema in hand (such as account.json) we
can generate the DDL to create the tables, and use the schema to validate the data.

An example schema:

```json
{
    "name": "User",
    "properties": {
        "id":          { "type": "integer", "required": true,  "primaryKey": true, "comment": "Unique identifier, auto-generated. It's the primary key." },
        "inserted":    { "type": "date",    "required": false, "dateOn": "insert", "comment": "Timestamp when current record is inserted" },
        "updated":     { "type": "date",    "required": false, "dateOn": "update", "comment": "Timestamp when current record is updated" },
        "age":         { "type": "integer", "required": false, "comment": "User age" },
        "email":       { "type": "string",  "required": false, "maxLength": 128, "unique": true, "comment": "Main email to communicate for user" },
        "name":        { "type": "string",  "required": true,  "maxLength": 128, "unique": true, "comment": "Descriptive name to identify the instance" },
        "phone":       { "type": "string",  "required": false, "maxLength": 128, "comment": "Phone associated with the user" },
        "preferences": { "type": "json",    "required": true,  "default": { "wrap": true, "minAge": 18 }, "comment": "All the general options associated with the user." }
    },
    "indices": [
        { "name": "inserted", "properties": ["inserted"] },
        { "name": "updated", "properties": ["updated"] },
        { "properties": ["email", "name", "phone"], "fulltext": true }
    ],
    "constraints": [
        { "name": "age", "check": "age > 10" },
        { "name": "email", "check": "email IS NULL OR email RLIKE '^[^@]+@[^@]+[.][^@]{2,}$'" },
        { "name": "phone", "check": "phone IS NULL OR phone RLIKE '^[0-9]{8,16}$'" }
    ]
}
```

Regardless of the type of database (i.e. SQLite, Mysql, etc), the DDL is generated in the same way. See below:

```typescript
import DB from "https://deno.land/x/dex/mod.ts";

const ddl = DB.createTable(UserSchema, "mysql", false, "UserTable");
```

The `ddl` string will contain:

```sql
CREATE TABLE IF NOT EXISTS UserTable (
    id          INTEGER NOT NULL PRIMARY KEY AUTO_INCREMENT COMMENT 'Unique identifier, auto-generated. It''s the primary key.',
    inserted    DATETIME DEFAULT CURRENT_TIMESTAMP COMMENT 'Timestamp when current record is inserted',
    updated     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Timestamp when current record is updated',
    age         INT COMMENT 'User age',
    email       VARCHAR(128) UNIQUE COMMENT 'Main email to communicate for that user',
    phone       VARCHAR(128) COMMENT 'Handle associated with the user',
    name        VARCHAR(128) NOT NULL UNIQUE COMMENT 'Descriptive name to identify the instance',
    preferences JSON NOT NULL DEFAULT ('{"wrap":true,"minAge":18}') COMMENT 'All the general options associated with the user.',
    INDEX inserted (inserted),
    INDEX updated (updated),
    FULLTEXT  (email,phone,name),
    CONSTRAINT user_age CHECK (age > 10),
    CONSTRAINT user_email CHECK (email IS NULL OR email RLIKE '^[^@]+@[^@]+[.][^@]{2,}$'),
    CONSTRAINT user_phone CHECK (phone IS NULL OR phone RLIKE '^[0-9]{8,16}$')
);
```

### Using DB events

DBX (via the repository) will emit type-specific events, everytime an object is `INSERT`ed, `UPDATE`d or `DELETE`d.

Quick example:

```typescript
import { DBX } from "https://deno.land/x/dbx/mod.ts";

let counter = 0;
const repo = await DB.getRepository(User);
repo.on("after-insert", function () {
    console.log(`Since server started, we have ${++counter} new users!`)
});
```


## Other objectives

These objectives did not classify as tenets ...

- Support [MariaDB](https://mariadb.org/), [MySQL](https://www.mysql.com/), [PostgreSQL](https://www.postgresql.org/) and [SQLite](https://www.sqlite.org/index.html).
- Use types to catch column typos and query mistakes
- Minimize syntax proliferation (if a `not`/`gt`/`lt` symbol is possible, do not make the user import [`Not`/`GreaterThan`/`LessThan`](https://typeorm.io/find-options#advanced-options) objects)
- Be as performant as possible, minimal overhead (dubious claim in ORM where 99% of time spent is in the DBMS round trip)
- Stay away from annotations (for as long as possible)
- Minimize dependencies

## Debugging

To see the SQL that is being executed, you can set the `DEBUG` environment variables as:

```
DEBUG=dbx:db
```

## Testing

To run the tests on top of the default DB (SQLite) run the following command. Note that the test access the environment
(to check `TEST_PROVIDER` and the network to connect to the DB).

```shell
deno test -A
```

To test other DBs (for example MySQL) you can run:

```shell
TEST_PROVIDER=mysql deno test -A
```


## Tasks

Tasks can be run via `deno task <task>`. Tasks below.

| Name            | Description                                                             |
|-----------------|-------------------------------------------------------------------------|
| `check`         | Checks Typescript code and formatting. Should be done before releasing. |
| `lint`          | Lints source code.                                                      |                     
| `release`       | Releases the library. Invoked as `deno task release minor` for example  |                     
| `test`          | Runs tests on top of a Memory embedded DB (SQLite)                      |                     
| `test-mysql`    | Runs tests on top of a real MySQL instance via docker.                  |                     
| `test-postgres` | Runs tests on top of a real Postgres instance via docker.               |                     

To release a custom script [release.sh](https://gist.github.com/acrodrig/8ca32ed618fe7d6d82900c1242d2eeb0) is used (following guidelines on [Publishing Your Deno Modules using GitHub](https://blog.bitsrc.io/publishing-your-deno-modules-using-github-f2bd86173392))

To make sure that Github and Codecov can talk, you need to set the `CODECOV_TOKEN` environment variable in the Github repository settings:

```bash
gh secret set CODECOV_TOKEN --body "$CODECOV_TOKEN"
```


## Roadmap

- [ ] Add a slow query warning by default (and allow to configure it)
- [ ] Write a more complete README that shows all the use cases
- [ ] Add support for MongoDB (important given how many ORMs support it)
- [ ] Add more tests and compute coverage (and publish it on README)
- [ ] Investigate replacing `EventEmitter` with more native event listener (potential issue is type-specificity)
