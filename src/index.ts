import axios from "axios";
import { config } from "dotenv";
import express, { Request, Response } from 'express';
import admin from "firebase-admin";
import qs from "querystring";
import { GCloudLogger, initializeFirebase } from './helper';
import { OrderHandler } from './order-handler';
import { AiraloSIMTopup, AiraloWrapper } from './services/airaloService';
import { DVPNService } from "./services/dVPNService";
import { SolanaService } from './services/solanaService';
import { TopupHandler } from './topup-handler';

// Declare db outside the async function so it's accessible later
let db: admin.database.Database;

const app = express()
app.use(express.json());

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
      url: "https://partners-api.airalo.com/v2/token",
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
