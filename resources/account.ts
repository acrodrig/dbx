export default class Account {
    id!: number;
    comments?: string;
    country = "US";
    email?: string;
    established = new Date();
    enabled = true;
    externalId?: string;
    name!: string;
    phone?: string;
    preferences: { [key: string]: boolean|number|string; } = { wrap: true, minAge: 18 };
    valueList: string[] = [];
    provider?: string;

    constructor(data?: Pick<Account, "name"> & Partial<Account>) {
        Object.assign(this, data);
    }
}
