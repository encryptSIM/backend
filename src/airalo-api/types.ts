import { paths } from "./schema";

export type Usage = NonNullable<NonNullable<paths['/v2/sims/{sim_iccid}/usage']['get']['responses']['200']['content']['application/json']>['data']>
export type TopupPackage = NonNullable<NonNullable<paths['/v2/sims/{iccid}/topups']['get']['responses']['default']['content']['application/json']['data']>[number]>
