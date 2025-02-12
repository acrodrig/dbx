/**
 * Accounts class definition
 * @table accounts
 * @fullText comments, country, phone, name
 * @index id, valueList, enabled
 */
export default class Account {
  /** Unique identifier, auto-generated. It's the primary key. @primaryKey */
  id!: number;

  /** Possible ETag for all resources that are external. Allows for better synch-ing. */
  etag?: string;

  /** General comments. Can be used for anything useful related to the instance. @maxLength 8192  */
  comments?: string;

  /** Country code @constraint LENGTH(country) <= 2 */
  country = "US";

  /**
   * Main email to communicate for that account
   * @unique
   * @constraint email IS NULL OR email REGEXP '^[^@]+@[^@]+[.][^@]{2,}$'
   * */
  email?: string;

  /** Date on which the account was established @maxLength 6 @minimum 2020-01-01 */
  established? = new Date();

  /** Whether it is enabled or not. Disabled instances will not be used. */
  enabled = true;

  /** External unique ID, used to refer to external accounts @maxLength 512 @unique */
  externalId?: string;

  /** Descriptive name to identify the instance @unique */
  name!: string;

  /**
   * Phone associated with the account
   * @constraint phone IS NULL OR phone REGEXP '^[0-9]{8,16}$'
   * @index
   */
  phone?: string;

  /** All the general options associated with the account.
   * @default ('{"wrap":true,"minAge":18}')
   **/
  preferences: { [key: string]: boolean|number|string; } = { wrap: true, minAge: 18 };

  /**
   * Auto-generated field with values
   * @as JSON_EXTRACT(preferences, '$.*')
   * @index id, valueList, enabled
   * @format hidden
   */
  valueList?: string[] = [];

  constructor(data?: Pick<Account, "name"> & Partial<Account>) {
      Object.assign(this, data);
  }
}
