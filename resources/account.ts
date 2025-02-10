/**
 * Accounts class definition
 * @table accounts
 * @fullText comments, country, phone, name
 */
export default class Account {
  /** Unique identifier, auto-generated. It's the primary key. @primaryKey */
  id!: number;

  /** General comments. Can be used for anything useful related to the instance. @maxLength 8192  */
  comments?: string;

  /** Country code */
  country = "US";

  /**
   * Main email to communicate for that account
   * @uniqueItems
   * @constraint email - email IS NULL OR email RLIKE '^[^@]+@[^@]+[.][^@]{2,}$'
   * */
  email?: string;

  /** Date on which the account was established @maxLength 6 @minimum 2020-01-01 */
  established? = new Date();

  /** Whether it is enabled or not. Disabled instances will not be used. */
  enabled = true;

  /** External unique ID, used to refer to external accounts @maxLength 512 @uniqueItems */
  externalId?: string;

  /** Handle associated with the account */
  name!: string;

  /**
   * Descriptive name to identify the instance
   * @constraint phone - phone IS NULL OR phone RLIKE '^[0-9]{8,16}$'
   */
  phone?: string;

  /** All the general options associated with the account. */
  preferences: { [key: string]: boolean|number|string; } = { wrap: true, minAge: 18 };

  /**
   * Auto-generated field with values
   * @as JSON_EXTRACT(preferences, '$.*')
   * @index id, valueList, enabled
   * */
  valueList: string[] = [];

  constructor(data?: Pick<Account, "name"> & Partial<Account>) {
      Object.assign(this, data);
  }
}
