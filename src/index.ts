import axios from "axios";
import { err, ok, Result, ResultAsync } from "neverthrow"
import { config } from "dotenv";
import express, { Request, Response } from 'express';
import admin from "firebase-admin";
import qs from "querystring";
import { GCloudLogger, initializeFirebase } from './helper';
import { OrderHandler } from './order-handler';
import { AiraloSIMTopup, AiraloWrapper, generateFakeSimsFromOrders, OrderDetailsSchema } from './services/airaloService';
import { DVPNService } from "./services/dVPNService";
import { SolanaService } from './services/solanaService';
import { TopupHandler } from './topup-handler';
import z from "zod";

// Declare db outside the async function so it's accessible later
let db: admin.database.Database;

const app = express()
app.use(express.json({ limit: '50mb' }));

config()

interface PaymentProfile {
  publicKey: string;
  privateKey: string;
}

let solanaService: SolanaService;
let airaloWrapper: AiraloWrapper;
let dVPNService: DVPNService;

async function main() {
  db = await initializeFirebase();

  const logger = new GCloudLogger();
  solanaService = new SolanaService(logger);

  airaloWrapper = new AiraloWrapper(db, logger);
  await airaloWrapper.initialize();

  dVPNService = new DVPNService();

  const orderHandler = new OrderHandler(db, solanaService, airaloWrapper, logger);
  const topupHandler = new TopupHandler(db, solanaService, airaloWrapper, logger);

  app.get("/cache/:key", async (req, res) => {
    const keyResult = z.string().min(1).safeParse(req.params.key);

    if (!keyResult.success) {
      const errorDetails = z.treeifyError(keyResult.error);
      console.error("Invalid cache key in GET request:", errorDetails);
      return res.status(400).json({
        success: false,
        message: "Bad request",
        error: errorDetails,
      });
    }

    const key = keyResult.data;

    try {
      const getResult: Result<any, Error> = await new Promise((resolve) => {
        db.ref(`/cache/${key}`)
          .once('value')
          .then((snapshot) => {
            const data = snapshot.val();
            resolve(ok(data));
          })
          .catch((error) => resolve(err(error)));
      });

      if (getResult.isErr()) {
        console.error("Failed to get data in GET request:", getResult.error);
        return res.status(500).json({
          success: false,
          message: "Internal server error",
          error: getResult.error.message,
        });
      }

      const data = getResult.value;

      if (data === null) {
        return res.status(404).json({
          success: false,
          message: "Cache key not found",
        });
      }

      console.log("Data successfully retrieved in GET request:", { key });
      return res.status(200).json({
        success: true,
        data: data,
      });
    } catch (error) {
      console.error("Unexpected error in GET request:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  });

  // Cache SET endpoint
  app.post("/cache/:key", async (req, res) => {
    const keyResult = z.string().min(1).safeParse(req.params.key);

    if (!keyResult.success) {
      const errorDetails = z.treeifyError(keyResult.error);
      console.error("Invalid cache key in POST request:", errorDetails);
      return res.status(400).json({
        success: false,
        message: "Bad request",
        error: errorDetails,
      });
    }

    const bodySchema = z.object({
      value: z.any(),
      ttl: z.number().optional(),
    });

    const bodyResult = bodySchema.safeParse(req.body);

    if (!bodyResult.success) {
      const errorDetails = z.treeifyError(bodyResult.error);
      console.error("Invalid request body in POST request:", errorDetails);
      return res.status(400).json({
        success: false,
        message: "Bad request",
        error: errorDetails,
      });
    }

    const key = keyResult.data;
    const { value, ttl } = bodyResult.data;

    try {
      const cacheData = {
        value,
        timestamp: Date.now(),
        ...(ttl && { ttl }),
      };

      const setResult: Result<void, Error> = await new Promise((resolve) => {
        db.ref(`/cache/${key}`)
          .set(cacheData)
          .then(() => resolve(ok(undefined)))
          .catch((error) => resolve(err(error)));
      });

      if (setResult.isErr()) {
        console.error("Failed to set data in POST request:", setResult.error);
        return res.status(500).json({
          success: false,
          message: "Internal server error",
          error: setResult.error.message,
        });
      }

      console.log("Data successfully cached in POST request:", { key, ttl });
      return res.status(200).json({
        success: true,
        message: "Data successfully cached",
      });
    } catch (error) {
      console.error("Unexpected error in POST request:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  });

  // Cache DELETE endpoint
  app.delete("/cache/:key", async (req, res) => {
    const keyResult = z.string().min(1).safeParse(req.params.key);

    if (!keyResult.success) {
      const errorDetails = z.treeifyError(keyResult.error);
      console.error("Invalid cache key in DELETE request:", errorDetails);
      return res.status(400).json({
        success: false,
        message: "Bad request",
        error: errorDetails,
      });
    }

    const key = keyResult.data;

    try {
      const deleteResult: Result<void, Error> = await new Promise((resolve) => {
        db.ref(`/cache/${key}`)
          .remove()
          .then(() => resolve(ok(undefined)))
          .catch((error) => resolve(err(error)));
      });

      if (deleteResult.isErr()) {
        console.error("Failed to delete data in DELETE request:", deleteResult.error);
        return res.status(500).json({
          success: false,
          message: "Internal server error",
          error: deleteResult.error.message,
        });
      }

      console.log("Data successfully deleted in DELETE request:", { key });
      return res.status(200).json({
        success: true,
        message: "Cache key successfully deleted",
      });
    } catch (error) {
      console.error("Unexpected error in DELETE request:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  });

  app.post("/sim-usage/:iccid/", async (req, res) => {
    const iccidResult = z.string().min(1).safeParse(req.params.iccid);

    if (!iccidResult.success) {
      const errorDetails = z.treeifyError(iccidResult.error);
      console.error("Invalid ICCID in POST request:", errorDetails);
      return res.status(400).json({
        success: false,
        message: "Bad request",
        error: errorDetails,
      });
    }

    const iccid = iccidResult.data;

    try {
      const setResult: Result<void, Error> = await new Promise((resolve) => {
        db.ref(`/sim-usage/${iccid}`)
          .set(req.body.data)
          .then(() => resolve(ok(undefined)))
          .catch((error) => resolve(err(error)));
      });

      if (setResult.isErr()) {
        console.error("Failed to set data in POST request:", setResult.error);
        return res.status(500).json({
          success: false,
          message: "Internal server error",
          error: setResult.error.message,
        });
      }

      console.log("Data successfully set in POST request:", { iccid, data: req.body.data });
      return res.status(200).json({
        success: true,
        message: "Data successfully set",
      });
    } catch (error) {
      console.error("Unexpected error in POST request:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  });

  // GET endpoint to retrieve data
  app.get("/sim-usage/:iccid/", async (req, res) => {
    const iccidResult = z.string().min(1).safeParse(req.params.iccid);

    if (!iccidResult.success) {
      const errorDetails = z.treeifyError(iccidResult.error);
      console.error("Invalid ICCID in GET request:", errorDetails);
      return res.status(400).json({
        success: false,
        message: "Bad request",
        error: errorDetails,
      });
    }

    const iccid = iccidResult.data;

    try {
      const getResult: Result<any, Error> = await new Promise((resolve) => {
        db.ref(`/sim-usage/${iccid}`)
          .get()
          .then((data) => resolve(ok(data)))
          .catch((error) => resolve(err(error)));
      });

      if (getResult.isErr()) {
        console.error("Failed to retrieve data in GET request:", getResult.error);
        return res.status(500).json({
          success: false,
          message: "Internal server error",
          error: getResult.error.message,
        });
      }

      const data = getResult.value;
      console.log("Data successfully retrieved in GET request:", { iccid, data });
      return res.status(200).json({
        success: true,
        data,
      });
    } catch (error) {
      console.error("Unexpected error in GET request:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  });


  app.post("/mark-sim-installed", async (req, res) => {
    const MarkSimInstalledBodySchema = z.object({
      installed: z.boolean(),
      iccid: z.string(),
      id: z.string()
    });

    const parseResult = MarkSimInstalledBodySchema.safeParse(req?.body);

    if (parseResult.error) {
      console.error(JSON.stringify(parseResult.error, null, 2));
      return res.status(400).json({
        success: false,
        message: "Bad request",
        error: z.treeifyError(parseResult.error),
      });
    }

    const { installed, iccid, id } = parseResult.data;

    const updateResult = await ResultAsync.fromPromise(
      db.ref(`sims/${id}/${iccid}`).update({ installed }),
      (error) => error
    );

    if (updateResult.isErr()) {
      console.error(
        JSON.stringify(
          {
            message: "Failed to update SIM's installation status in the database",
            data: {
              error: updateResult.error,
            },
          },
          null,
          2
        )
      );
      return res.status(500).json({
        success: false,
        message: "Failed to update SIM's installation status in the database",
        error: updateResult.error,
      });
    }

    console.info(
      JSON.stringify(
        {
          message: "SIM updated completed successfully",
          data: { iccid, installed },
        },
        null,
        2
      )
    );
    return res.status(200).json({ success: true, message: "Success" });
  });

  app.post("/complete-order", async (req, res) => {
    const CompleteOrderBodySchema = z.object({
      orders: OrderDetailsSchema.array(),
      id: z.string(),
    });

    const parseResult = CompleteOrderBodySchema.safeParse(req?.body);

    if (parseResult.error) {
      console.error(JSON.stringify(parseResult.error, null, 2));
      return res.status(400).json({
        success: false,
        message: "Bad request",
        error: z.treeifyError(parseResult.error),
      });
    }

    const { orders, id } = parseResult.data;

    let sims;

    if (process.env.MOCK_COMPLETE_ORDER_ENABLED === "true") {
      sims = generateFakeSimsFromOrders(orders);
    } else {
      const placeOrderResults = await Promise.all(
        orders.map((order) =>
          ResultAsync.fromPromise(
            airaloWrapper.placeOrder(order),
            (error) => error
          )
        )
      );

      const failedOrders = placeOrderResults.filter((result) => result.isErr());
      if (failedOrders.length > 0) {
        console.error(
          JSON.stringify(
            {
              message: "Failed to place some orders",
              data: {
                failedOrders: failedOrders.map((result) => result.error),
              },
            },
            null,
            2
          )
        );
        return res.status(500).json({
          success: false,
          message: "Failed to place some orders",
          errors: failedOrders.map((result) => result.error),
        });
      }

      sims = placeOrderResults
        .map((result) => {
          if (result.isOk()) return result.value;
          return null;
        })
        .filter((t) => !!t);
    }

    const simsObject = sims.reduce((acc, sim) => {
      acc[sim.iccid] = sim;
      return acc;
    }, {});

    const updateResult = await ResultAsync.fromPromise(
      db.ref(`sims/${id}`).update(simsObject),
      (error) => error
    );

    if (updateResult.isErr()) {
      console.error(
        JSON.stringify(
          {
            message: "Failed to update SIMs in the database",
            data: {
              error: updateResult.error,
            },
          },
          null,
          2
        )
      );
      return res.status(500).json({
        success: false,
        message: "Failed to update SIMs in the database",
        error: updateResult.error,
      });
    }

    console.info(
      JSON.stringify(
        {
          message: "Order completed successfully",
          data: { id, sims },
        },
        null,
        2
      )
    );
    return res.status(200).json({ success: true, message: "Order completed", sims });
  });

  app.get("/fetch-sims/:id", async (req, res) => {
    const { id } = req.params;

    if (!id) {
      const errorMessage = {
        message: "Missing ID in request parameters",
      };
      console.error(JSON.stringify(errorMessage, null, 2));
      return res.status(400).json({
        success: false,
        message: errorMessage.message,
      });
    }

    const fetchResult = await ResultAsync.fromPromise(
      db.ref(`sims/${id}`).once("value"),
      (error) => error
    );

    if (fetchResult.isErr()) {
      console.error(
        JSON.stringify(
          {
            message: "Failed to fetch SIMs from the database",
            data: { id, error: fetchResult.error },
          },
          null,
          2
        )
      );
      return res.status(500).json({
        success: false,
        message: "Failed to fetch SIMs from the database",
        error: fetchResult.error,
      });
    }

    const simsSnapshot = fetchResult.value;

    if (!simsSnapshot.exists()) {
      const warningMessage = {
        message: "No SIMs found for the given ID",
        data: { id },
      };
      console.info(JSON.stringify(warningMessage, null, 2));
      return res.status(404).json({
        success: false,
        message: warningMessage.message,
      });
    }

    const sims = simsSnapshot.val();

    console.info(
      JSON.stringify(
        {
          message: "SIMs fetched successfully",
          data: { id, sims },
        },
        null,
        2
      )
    );
    return res.status(200).json({
      success: true,
      message: "SIMs fetched successfully",
      data: Object.values(sims),
    });
  });

  app.get("/airalo/token", async (req, res) => {
    const AIRALO_CLIENT_ID = process.env.AIRALO_CLIENT_ID;
    const AIRALO_CLIENT_SECRET = process.env.AIRALO_CLIENT_SECRET;

    if (!AIRALO_CLIENT_ID || !AIRALO_CLIENT_SECRET) {
      return res.status(500).json({
        error: "Airalo client ID or secret not configured in environment variables.",
      });
    }

    const requestBody = qs.stringify({
      client_id: AIRALO_CLIENT_ID,
      client_secret: AIRALO_CLIENT_SECRET,
      grant_type: "client_credentials",
    });

    const options = {
      method: "POST",
      url: `${process.env.AIRALO_CLIENT_URL}/v2/token`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: requestBody,
    };

    try {
      const { data } = await axios.request(options);
      console.log("Airalo Token Response:", data);
      return res.status(200).json(data);
    } catch (error) {
      console.error("Error fetching Airalo token:", error.response ? error.response.data : error.message);

      return res.status(error.response ? error.response.status : 500).json({
        error: "Failed to obtain Airalo token",
        details: error.response ? error.response.data : error.message,
      });
    }
  });

  // === DVPN HANDLER ===

  // Create device
  app.post('/vpn/create-device', async (req, res) => {
    try {
      // create device
      const deviceInfo = await dVPNService.createDevice();
      logger.logINFO(`deviceInfo: ${JSON.stringify(deviceInfo)}`);

      return res.json({
        data: deviceInfo.data,
      });
    } catch (err) {
      logger.logERROR(err?.response?.data || err);
      res.status(500).json({ error: 'Failed to create device' });
    }
  });

  // Get countries
  app.get('/vpn/countries/:deviceToken', async (req, res) => {
    try {
      const { deviceToken } = req.params;

      // find countries
      const countries = await dVPNService.getCountries(deviceToken);
      logger.logINFO(`countries: ${JSON.stringify(countries)}`);
      if (countries.data.length === 0) return res.status(404).json({ error: 'No countries found' });

      return res.json({
        data: countries.data,
      });
    } catch (err) {
      logger.logERROR(err?.response?.data || err);
      res.status(500).json({ error: 'Failed to get countries' });
    }
  });

  // Get cities
  // Route: /vpn/cities/:countryId?deviceToken=abc123
  app.get('/vpn/cities/:countryId', async (req, res) => {
    try {
      const { countryId } = req.params;
      const { deviceToken } = req.query;

      if (!deviceToken) return res.status(400).json({ error: 'Missing deviceToken' });

      const cities = await dVPNService.getCities(deviceToken as string, countryId);
      logger.logINFO(`cities: ${JSON.stringify(cities)}`);

      if (cities.data.length === 0)
        return res.status(404).json({ error: 'No cities found' });

      return res.json({ data: cities.data });
    } catch (err) {
      logger.logERROR(err?.response?.data || err);
      res.status(500).json({ error: 'Failed to get cities' });
    }
  });

  // Get servers
  // Route: /vpn/servers/:cityId?deviceToken=abc123
  app.get('/vpn/servers/:cityId', async (req, res) => {
    try {
      const { cityId } = req.params;
      const { deviceToken } = req.query;

      if (!deviceToken) return res.status(400).json({ error: 'Missing deviceToken' });

      // find servers
      const servers = await dVPNService.getServers(deviceToken as string, cityId);
      logger.logINFO(`servers: ${JSON.stringify(servers)}`);
      if (servers.data.length === 0) return res.status(404).json({ error: 'No servers found' });

      return res.json({ data: servers.data });
    } catch (err) {
      logger.logERROR(err?.response?.data || err);
      res.status(500).json({ error: 'Failed to get cities' });
    }
  });

  // Create server credentials
  // Route: /vpn/create-credentials/:serverId?deviceToken=abc123
  app.post('/vpn/create-credentials/:serverId', async (req, res) => {
    try {
      const { serverId } = req.params;
      const { deviceToken } = req.query;

      if (!deviceToken) return res.status(400).json({ error: 'Missing deviceToken' });

      const credentials = await dVPNService.createServerCredentials(deviceToken as string, serverId);
      logger.logINFO(`credentials: ${JSON.stringify(credentials)}`);

      const configText = dVPNService.buildWireGuardConf(credentials.data);
      logger.logINFO(`configText: ${JSON.stringify(configText)}`);

      return res.json({
        credentials: credentials,
        config: configText,
      });
    } catch (err) {
      logger.logERROR(err?.response?.data || err);
      res.status(500).json({ error: 'Failed to get cities' });
    }
  });

  // Get all config to active VPN
  app.post('/vpn/active', async (req, res) => {
    try {
      // create device
      const deviceInfo = await dVPNService.createDevice();

      // find countries
      const deviceToken = deviceInfo.data.token;
      const countries = await dVPNService.getCountries(deviceToken);
      if (countries.data.length === 0) return res.status(404).json({ error: 'No countries found' });

      // find cities
      const randomCountry = countries.data[Math.floor(Math.random() * countries.data.length)];
      const cities = await dVPNService.getCities(deviceToken, randomCountry.id);
      if (cities.data.length === 0) return res.status(404).json({ error: 'No cities found' });

      // find servers
      const randomCity = cities.data[Math.floor(Math.random() * cities.data.length)];
      const servers = await dVPNService.getServers(deviceToken, randomCity.id);
      if (servers.data.length === 0) return res.status(404).json({ error: 'No servers found' });

      const randomServer = servers.data[Math.floor(Math.random() * servers.data.length)];
      const credentials = await dVPNService.createServerCredentials(deviceToken, randomServer.id);

      const configWireGuard = dVPNService.buildWireGuardConf(credentials.data);
      logger.logINFO(`configWireGuard: ${JSON.stringify(configWireGuard)}`);
      return res.json({
        deviceToken: deviceToken,
        raw: credentials,
        configWireGuard: configWireGuard,
      });
    } catch (err) {
      logger.logERROR(err?.response?.data || err);
      res.status(500).json({ error: 'Failed to get VPN configuration' });
    }
  });

  // === PAYMENT PROFILE HANDLER ===

  // User must have payment profile as unique identifier to manage payment and esim subcription
  app.post('/create-payment-profile', async (req: Request, res: Response) => {
    try {
      const { publicKey, privateKey } = await solanaService.createNewSolanaWallet();
      const paymentProfile: PaymentProfile = { publicKey, privateKey }

      await db.ref(`/payment_profiles/${publicKey}`).set(paymentProfile);

      return res.status(200).json({ publicKey });
    } catch (error: any) {
      logger.logERROR(`Error creating payment profile: ${error}`);
      // Log error to Firebase
      return res.status(500).json({ error: "Failed to create payment profile" });
    }
  });

  // === ORDER HANDLER ===
  app.post('/order', orderHandler.createOrder);
  app.post('/add-order', orderHandler.addOrder);
  // to be routinely called by front-end to check if order has been fulfilled
  app.get('/order/:orderId', orderHandler.queryOrder);

  // Endpoint to create a new top-up order
  app.post('/topup', topupHandler.createTopupOrder);
  app.get('/topup/:orderId', topupHandler.queryTopUpOrder);

  app.get('/payment-profile/topup/:ppPublicKey', topupHandler.queryPPTopupOrder);
  app.get('/payment-profile/sim/:ppPublicKey', orderHandler.queryPPOrder);

  // Endpoint to get available top-up packages for a SIM
  app.get('/sim/:iccid/topups', async (req: Request, res: Response) => {
    try {
      const { iccid } = req.params;

      if (!iccid) {
        return res.status(400).json({ error: 'Missing required parameter: iccid' });
      }
      const topups: AiraloSIMTopup[] = await airaloWrapper.getSIMTopups(iccid);

      if (!topups) {
        // This typically means the service encountered an error it couldn't recover from,
        // or the method in the service is designed to return undefined in some error cases.
        // Log error to Firebase
        return res.status(500).json({ error: 'Failed to retrieve SIM top-ups' });
      }

      return res.json(topups);

    } catch (error: any) {
      logger.logERROR(`Error getting top-ups for ICCID ${req.params.iccid}: ${error}`);
      const errorMessage = error.message || "Failed to retrieve SIM top-ups";
      // Log error to Firebase
      return res.status(500).json({ error: errorMessage });
    }
  });

  app.get('/sim/:iccid/usage', async (req: Request, res: Response) => {
    try {
      const { iccid } = req.params;

      if (!iccid) {
        return res.status(400).json({ error: 'Missing required parameter: iccid' });
      }
      const usage: any = await airaloWrapper.getDataUsage(iccid);

      // if (!usage) {
      //   // This typically means the service encountered an error it couldn't recover from,
      //   // or the method in the service is designed to return undefined in some error cases.
      //   return res.status(500).json({ error: 'Failed to retrieve SIM top-ups' });
      // }

      return res.json(usage);

    } catch (error: any) {
      logger.logERROR(`Error getting usage for ICCID ${req.params.iccid}: ${error}`);
      const errorMessage = error.message || "Failed to retrieve SIM usage";
      // Log error to Firebase
      return res.status(500).json({ error: errorMessage });
    }
  });

  // GET handler to get packages from getPackagePlans()
  app.get('/packages', async (req: Request, res: Response) => {
    try {
      const { type, country } = req.query;

      if (!type) {
        return res.status(400).json({ error: 'Missing required parameters: type' });
      }

      // Cast type to the expected union type, assuming valid input based on validation above
      const packageType = type as 'global' | 'local' | 'regional';

      const packages = await airaloWrapper.getPackagePlans(packageType, country as string);

      if (packages === undefined) {
        // This case is handled in the service by returning undefined on error
        // Log error to Firebase
        return res.status(500).json({ error: 'Failed to retrieve package plans' });
      }

      return res.json(packages);
    } catch (error: any) {
      logger.logERROR(`Error in /packages endpoint: ${error}`);
      // Log error to Firebase
      return res.status(500).json({ error: "Failed to retrieve package plans" });
    }
  });



  // Endpoint to log errors from the frontend or other sources
  app.post('/error', async (req: Request, res: Response) => {
    try {
      const { message } = req.body;
      const errorLog = {
        message: message
      };

      // Save error log to Firebase
      const timestamp = new Date().toISOString();
      const timestampKey = timestamp.replace(/[^a-zA-Z0-9]/g, '_'); // Create a valid key
      await db.ref(`/error_logs/${timestampKey}`).set(errorLog);

      logger.logINFO(`error logged: ${message}`)

      return res.status(200).send("OK")
    } catch (error: any) {
      logger.logERROR(`Error processing error log request: ${error}`);
      // Log error about the logging process itself
      return res.status(500).json({ success: false, message: "Failed to process log request" });
    }
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    return res.send("OK");
  });

  const port = parseInt(process.env.PORT || '3000');
  app.listen(port, () => {
    console.log(`listening on port ${port}`);
  });

}

// Call the main async function to start the application
main().catch(console.error);
