import { paths } from "./schema";

export type Usage = NonNullable<NonNullable<paths['/v2/sims/{sim_iccid}/usage']['get']['responses']['200']['content']['application/json']>['data']>
export type GetPackagesResponse = paths["/v2/packages"]["get"]["responses"]["200"]["content"]["application/json"];
export type Operator = NonNullable<NonNullable<GetPackagesResponse["data"]>[number]["operators"]>[number];
export type Coverage = NonNullable<Operator["coverages"]>[number];
