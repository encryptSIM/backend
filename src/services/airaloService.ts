import { config } from "dotenv";
import { faker } from '@faker-js/faker';
import { AiraloService, AiraloPackage } from "@montarist/airalo-api";
import * as admin from "firebase-admin";
import { accessSecretValue, GCloudLogger } from "../helper";
import z from "zod";

config();

export interface SimOrder {
  iccid: string;
  qrcode: string;
  qrcode_url: string;
  created_at: string;
  direct_apple_installation_url?: string;
  country_code?: string
  package_id: string
  created_at_ms: number
  package_title: string
  expiration_ms: number
  region?: string
}
export function generateFakeSims(count: number, order: OrderDetails): SimOrder[] {
  return Array.from({ length: count }, () => ({
    iccid: faker.string.numeric({
      length: 20,
      allowLeadingZeros: false,
    }),
    qrcode: faker.string.alphanumeric(32),
    package_title: order.package_title,
    expiration_ms: order.expiration_ms,
    created_at_ms: order.created_at_ms,
    package_id: order.package_id,
    qrcode_url: faker.internet.url(),
    created_at: faker.date.past().toISOString(),
    direct_apple_installation_url: faker.datatype.boolean()
      ? faker.internet.url()
      : undefined,
  }));
}

export function generateFakeSimsFromOrders(orders: OrderDetails[]): SimOrder[] {
  return orders.flatMap((order) =>
    Array.from({ length: order.quantity }, () => {
      const iccid = faker.string.numeric({
        length: 20,
        allowLeadingZeros: false,
      }); // Generate a 20-digit numeric ICCID
      const qrcode = `LPA:1$wbg.prod.ondemandconnectivity.com$${faker.string.alphanumeric(
        16
      ).toUpperCase()}`; // Generate a fake LPA QR code
      const qrcodeUrl = `https://www.airalo.com/qr?expires=${faker.date
        .future()
        .getTime()}&id=${faker.string.numeric(8)}&signature=${faker.string.alphanumeric(
          64
        )}`; // Generate a fake Airalo QR code URL
      const directAppleInstallationUrl = `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${qrcode}`; // Generate a fake Apple installation URL

      return {
        region: order.region,
        country_code: order.country_code,
        package_title: order.package_title,
        package_id: order.package_id,
        expiration_ms: order.expiration_ms,
        created_at_ms: order.created_at_ms,
        iccid,
        qrcode,
        qrcode_url: qrcodeUrl,
        created_at: faker.date.past().toISOString(), // Generate a past date in ISO format
        direct_apple_installation_url: faker.datatype.boolean()
          ? directAppleInstallationUrl // Randomly include the Apple installation URL
          : undefined,
      };
    })
  );
}

export const OrderDetailsSchema = z.object({
  quantity: z.number().min(1).max(50),
  package_id: z.string().min(1),
  package_title: z.string().min(1),
  country_code: z.string().min(1).optional(),
  expiration_ms: z.number(),
  created_at_ms: z.number(),
  region: z.string().min(1).optional(),
})
export type OrderDetails = z.infer<typeof OrderDetailsSchema>
// Assumed interface for parameters to create a top-up order
export interface AiraloTopupOrderParams {
  iccid: string;
  package_id: string;
  description?: string;
}

// Assumed interface for the response of a top-up order
export interface AiraloTopupOrder {
  id: string;
  package_id: string;
  currency: string;
  quantity: number;
  description: string;
  esim_type: string;
  data: string;
  price: number;
  net_price: number;
}

// Assumed interface for an available SIM top-up package
export interface AiraloSIMTopup {
  id: string; // package_id for the top-up
  title: string;
  data_amount: string; // e.g., "1GB", "5GB"
  validity_days: number; // e.g., 7, 30
  price: number;
  currency: string; // e.g., "USD"
}

export interface ExportedPackage {
  id: number;
  price: number;
  day: number;
  data: number;
}

export interface ExportedOperator {
  id: number;
  title: string;
  packages: ExportedPackage[];
}

export interface ExportedAiraloPackage {
  region: string,
  operators: ExportedOperator[];
}

export class AiraloWrapper {
  private db: admin.database.Database;
  private airaloService: AiraloService;
  private logger: GCloudLogger

  constructor(db: admin.database.Database, logger) {
    this.db = db; // Receive the initialized db instance
    this.logger = logger;
  }

  public async initialize() {
    const clientId = process.env.AIRALO_CLIENT_ID;
    const clientSecret = await accessSecretValue("AIRALO_CLIENT_SECRET");
    const clientUrl = process.env.AIRALO_CLIENT_URL;

    if (!clientId) {
      throw new Error("AIRALO_CLIENT_ID environment variable is not set.");
    }

    this.airaloService = new AiraloService({
      baseUrl: clientUrl,
      clientId,
      clientSecret
    });
  }

  public async placeOrder(
    orderDetails: OrderDetails
  ): Promise<SimOrder> {
    try {
      const response = await this.airaloService.createOrder({
        package_id: orderDetails.package_id,
        quantity: orderDetails.quantity,
        type: "sim",
      });

      console.log('eSim buy response: ', response)
      const data_json = JSON.stringify(response);
      const parsed_sim = JSON.parse(data_json);
      const sims = parsed_sim.data.sims
      const sim = sims[0]
      console.log('received sims: ', sims)

      return {
        iccid: sim.iccid,
        qrcode: sim.qrcode,
        package_title: orderDetails.package_title,
        package_id: orderDetails.package_id,
        qrcode_url: sim.qrcode_url,
        expiration_ms: orderDetails.expiration_ms,
        created_at_ms: orderDetails.created_at_ms,
        created_at: sim.created_at,
        direct_apple_installation_url: sim.direct_apple_installation_url
      };
    } catch (error: any) {
      this.logger.logERROR(`Error placing Airalo order: ${error}`);
      throw new Error(error.message);
    }
  }
  // : Promise<AiraloOrder>
  public async createTopupOrder(orderData: AiraloTopupOrderParams): Promise<AiraloTopupOrder> {
    try {

      const params: any = {
        package_id: orderData.package_id,
        iccid: orderData.iccid,
        description: orderData.description,
      }
      console.log("param: ", params);
      const response = await this.airaloService.createTopupOrder(params);

      console.log('eSim top-up order response: ', response);
      const data_json = JSON.stringify(response);
      const parsed_order = JSON.parse(data_json);

      console.log("topupOrder: ", parsed_order);


      return {
        id: parsed_order.data.id,
        package_id: parsed_order.data.package_id,
        currency: parsed_order.data.currency,
        quantity: parsed_order.data.quantity,
        description: parsed_order.data.description,
        esim_type: parsed_order.data.esim_type,
        data: parsed_order.data.data,
        price: parsed_order.data.price,
        net_price: parsed_order.data.net_price,     // Adjust path as per actual SDK response
      };
    } catch (error: any) {
      this.logger.logERROR(`Error placing Airalo top-up order: ${error}`);
      throw new Error(error.message);
    }
  }
  // : Promise<AiraloSIMTopup[]>
  public async getSIMTopups(iccid: string): Promise<AiraloSIMTopup[]> {
    try {
      const cacheKey = `topups/${iccid}`;
      const cachedData = await this.db.ref(cacheKey).once('value');
      const cacheEntry = cachedData.val();
      const now = Date.now();
      const twentyFourHoursInMillis = 24 * 60 * 60 * 1000;

      if (cacheEntry && cacheEntry.timestamp && (now - cacheEntry.timestamp < twentyFourHoursInMillis)) {
        console.log("Returning cached data for", cacheKey);
        return cacheEntry.data;
      }

      console.log("Fetching data from Airalo API for", cacheKey);
      const topups = await this.airaloService.getSIMTopups(iccid);
      const data_json = JSON.stringify(topups);
      const parsed_item = JSON.parse(data_json);

      let cleanedTopupData = [];
      for (const item of parsed_item.data) {
        const newObj = {};
        newObj["id"] = item.id;
        newObj["price"] = item.price;
        newObj["amount"] = item.amount;
        newObj["day"] = item.day;
        newObj["is_unlimited"] = item.is_unlimited;
        newObj["title"] = item.title;
        newObj["data"] = item.data;
        newObj["net_price"] = item.net_price;

        cleanedTopupData.push(newObj);
      }
      console.log("topups: ", cleanedTopupData);

      await this.db.ref(cacheKey).set({ data: cleanedTopupData, timestamp: now });
      console.log("Cached data to Firebase for", cacheKey);

      return cleanedTopupData;


    } catch (error: any) {
      this.logger.logERROR(`Error getting SIM top-ups for ICCID ${iccid}: ${error}`);
      throw new Error(error.message);
    }
  }

  public async getSIMDetails(iccid: string): Promise<any> {
    const sim = await this.airaloService.getSIM(iccid)
    const data_json = JSON.stringify(sim)
    console.log(data_json)
    const parsed_sim = JSON.parse(data_json)
    const new_sim_obj = {};

    new_sim_obj['iccid'] = parsed_sim.data.iccid;
    new_sim_obj['created_at'] = parsed_sim.data.created_at;

    return new_sim_obj
  }

  //: Promise<AiraloSIMTopup[]>
  public async getDataUsage(iccid: string): Promise<any[]> {
    try {
      // console.log("Fetching data from Airalo API for", cacheKey);
      const topups = await this.airaloService.getSIMUsage(iccid);
      const data_json = JSON.stringify(topups);
      const parsed_item = JSON.parse(data_json);
      //console.log("data_usage: ", parsed_item.data);
      return parsed_item.data;


    } catch (error: any) {
      this.logger.logERROR(`Error getting SIM top-ups for ICCID ${iccid}: ${error}`);
      throw new Error(error.message);
    }
  }

  public async getPackagePlans(type: 'global' | 'local' | 'regional', country?: string): Promise<any[]> {
    try {
      const cacheKey = `package-plans/${type}/${country || 'global'}`;
      const cachedData = await this.db.ref(cacheKey).once('value');
      console.log(cachedData)

      const cacheEntry = cachedData.val();
      const now = Date.now();
      const twentyFourHoursInMillis = 24 * 60 * 60 * 1000;

      if (cacheEntry && cacheEntry.timestamp && (now - cacheEntry.timestamp < twentyFourHoursInMillis)) {
        this.logger.logINFO(`Returning cached data for ${cacheKey}`);
        return cacheEntry.data;
      }

      const packages = await this.airaloService.getPackages({
        type,
        country
      });

      // parsing information
      const cleanedPackageData = parsePackageResponse(packages.data);

      // Cache the fetched data with a timestamp
      await this.db.ref(cacheKey).set({ data: cleanedPackageData, timestamp: now });

      return cleanedPackageData
    } catch (error) {
      this.logger.logERROR(`Error getting package plans: ${error}`);
      throw new Error(error.message);
    }
  }
}

export function parsePackageResponse(packages: AiraloPackage[]): any[] {
  let cleanedPackageData = [];
  for (const item of packages) {
    let newObj = {};
    const data_json = JSON.stringify(item);
    const parsed_item = JSON.parse(data_json);
    newObj["region"] = parsed_item.slug;
    newObj["operators"] = []

    for (const operator of parsed_item.operators) {
      const newOperator = {};
      newOperator["id"] = operator.id;
      newOperator["title"] = operator.title;
      newOperator["packages"] = [];

      for (const packageItem of operator.packages) {
        newOperator["packages"].push({
          id: packageItem.id,
          price: packageItem.price,
          day: packageItem.day,
          data: packageItem.data
        });
      }
      newObj["operators"].push(newOperator);
    }

    cleanedPackageData.push(newObj);
  }

  return cleanedPackageData
}
