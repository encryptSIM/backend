import { paths } from "./schema";

export type Usage = NonNullable<NonNullable<paths['/v2/sims/{sim_iccid}/usage']['get']['responses']['200']['content']['application/json']>['data']>
