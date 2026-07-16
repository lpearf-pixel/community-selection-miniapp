export type TaxRecordAdminScope={isSuperAdmin:boolean;communityIds:string[];pickupStoreIds:string[]};
export type TaxRecordScopeFilters={sourceType:'withdrawal';taxMode?:string;taxStatus?:string;invoiceStatus?:string;leaderUserId?:string;withdrawalId?:string;keyword?:string;createdAtFromInclusive?:Date;createdAtToInclusive?:Date;createdAtToExclusive?:Date};
