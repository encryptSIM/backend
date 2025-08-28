import cors from 'cors';
import { config } from "dotenv";
import express from 'express';
import qs from "querystring";
import { GCloudLogger, initializeFirebase } from './helper';
import { OrderHandler } from './order-handler';
import routes from './routes';
import { AiraloWrapper } from './services/airaloService';
import { DVPNService } from "./services/dVPNService";
import { SolanaService } from './services/solanaService';
import admin from "firebase-admin";
import { TopupHandler } from './topup-handler';

const app = express();
app.use(express.json({ limit: '50mb' }));

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.options("*", cors());

config();

export interface Services {
  solanaService: SolanaService;
  airaloWrapper: AiraloWrapper;
  dVPNService: DVPNService;
  orderHandler: OrderHandler;
  topupHandler: TopupHandler;
  logger: GCloudLogger;
  database: admin.database.Database;
  firestore: admin.firestore.Firestore;
}

async function main() {
  const { database, firestore } = await initializeFirebase();
  const logger = new GCloudLogger();

  const solanaService = new SolanaService(logger);
  const airaloWrapper = new AiraloWrapper(database, logger);
  await airaloWrapper.initialize();

  const dVPNService = new DVPNService();
  const orderHandler = new OrderHandler(database, solanaService, airaloWrapper, logger);
  const topupHandler = new TopupHandler(database, solanaService, airaloWrapper, logger);

  const services: Services = {
    solanaService,
    airaloWrapper,
    dVPNService,
    orderHandler,
    topupHandler,
    logger,
    database,
    firestore
  };

  app.set("query parser", (str: string) => qs.parse(str));

  // Use all routes
  app.use(routes(services));

  const port = parseInt(process.env.PORT || '3000');
  app.listen(port, () => {
    console.log(`listening on port ${port}`);
  });
}

main().catch(console.error);
