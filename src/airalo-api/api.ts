import createFetchClient from "openapi-fetch";
import type { paths } from "./schema";

export const airaloFetchClient = createFetchClient<paths>({
  baseUrl: process.env.AIRALO_CLIENT_URL,
});
