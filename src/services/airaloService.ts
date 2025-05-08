import { config } from "dotenv";
import { AiraloService, AiraloPackage } from "@montarist/airalo-api";
import * as admin from "firebase-admin";
config();

export interface SimOrder {
  iccid: string;
  qrcode: string;
  qrcode_url: string;
  created_at: string;
  direct_apple_installation_url?: string;
}

export interface OrderDetails {
  quantity: number;
  package_id: string;
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

export class EsimService{
  private db: admin.database.Database;
  private airaloService: AiraloService;

  constructor(db: admin.database.Database) {
    this.db = db; // Receive the initialized db instance

    const clientId = process.env.AIRALO_CLIENT_ID;
    const clientSecret = process.env.AIRALO_CLIENT_SECRET;
    const clientUrl = process.env.AIRALO_CLIENT_URL;

    if (!clientId) {
      throw new Error("AIRALO_CLIENT_ID environment variable is not set.");
    }
    if (!clientSecret) {
      throw new Error("AIRALO_CLIENT_SECRET environment variable is not set.");
    }
    this.airaloService = new AiraloService({ 
      baseUrl: clientUrl,
      clientId, 
      clientSecret
    });
  }

  // Removed the connectToFirebase method

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
        qrcode_url: sim.qrcode_url,
        created_at: sim.created_at,
        direct_apple_installation_url: sim.direct_apple_installation_url
      };
    } catch (error: any) {
      console.error("Error placing Airalo order:", error);
      throw new Error(error.message);
    }
  }

  public async getPackagePlans(type: 'global' | 'local' | 'regional', country?: string): Promise<any[]> {
    try {
      const cacheKey = `package-plans/${type}/${country || 'global'}`;
      const cachedData = await this.db.ref(cacheKey).once('value');
      const cacheEntry = cachedData.val();
      const now = Date.now();
      const twentyFourHoursInMillis = 24 * 60 * 60 * 1000;

      if (cacheEntry && cacheEntry.timestamp && (now - cacheEntry.timestamp < twentyFourHoursInMillis)) {
        console.log("Returning cached data for", cacheKey);
        return cacheEntry.data;
      }

      console.log("Fetching data from Airalo API for", cacheKey);
      const packages = await this.airaloService.getPackages({
        type,
        country
      });

      // parsing information
      let cleanedPackageData = [];
      for (const item of packages.data) {
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

        console.log(newObj)
        cleanedPackageData.push(newObj);
      }
      console.log(cleanedPackageData)

      // Cache the fetched data with a timestamp
      await this.db.ref(cacheKey).set({ data: cleanedPackageData, timestamp: now });
      console.log("Cached data to Firebase for", cacheKey);

      return cleanedPackageData
    } catch (error) {
      console.error("Error getting package plans:", error);
      throw new Error(error.message);
    }
  }
}
