import express, { NextFunction, Request, Response } from 'express';
import { config } from "dotenv";
import { SimOrder, EsimService } from './services/airaloService';
import { SolanaService } from './services/solanaService';
import admin from "firebase-admin";
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

// Declare db outside the async function so it's accessible later
let db: admin.database.Database;

async function initializeFirebase() {
  // Initialize Firebase Admin SDK
  const firebaseDatabaseUrl: string = process.env.FIREBASE_DB_URL || "";
  if (admin.apps.length === 0){
    // Fetch the service account using the async function
    const serviceAccount = await accessSecretVersion('firebase-admin'); // Use the correct secret name

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount as any), // Use the fetched service account
      databaseURL: firebaseDatabaseUrl,
    });
  }
  db = admin.database(); // Assign the initialized database to the global variable
}


const app = express()
app.use(express.json());

config()

interface PaymentProfile {
  publicKey: string;
  privateKey: string;
  orderIds?: string[];
  createdAt: string; // Add timestamp for profile creation
  updatedAt: string; // Add timestamp for profile updates
  email?: string; // Added email and name based on previous conversation
  name?: string;
}

interface Order {
  orderId: string;
  ppPublicKey: string;
  quantity: number;
  package_id: string;
  package_price: string;
  paymentReceived: boolean;
  paidToMaster: boolean;
  paymentInSol?: number;
  sim?: SimOrder;
  createdAt: string; // Add timestamp for order creation
  updatedAt: string; // Add timestamp for order updates
  status: 'pending' | 'paid' | 'esim_provisioned' | 'paid_to_master' | 'cancelled' | 'failed'; 
}

const solanaService = new SolanaService();
const esimService = new EsimService();
try{
  esimService.connectToFirebase()
} catch (error) {
  console.log('Error connecting to firebase:', error);
}

export async function addOrderToPaymentProfile(ppPublicKey: string, orderId: string): Promise<void> {
  try {
    const paymentProfileRef = db.ref(`/payment_profiles/${ppPublicKey}`);
    const paymentProfileSnapshot = await paymentProfileRef.once('value');
    const currentPaymentProfileData = paymentProfileSnapshot.val() || {};

    let orderIds: string[] = currentPaymentProfileData.orderIds || [];
    if (!orderIds.includes(orderId)) { // Prevent duplicates
        orderIds.push(orderId);
    }

    await paymentProfileRef.update({ orderIds, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error('Error updating payment profile with order:', error);
    throw error;
  }
}

interface AuthenticatedRequest extends Request {
  authenticatedUserId?: string; // Add a field for the authenticated user's ID
}

const authenticateUser = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Expect "Bearer <token>"
  if (!token) {
    return res.status(401).json({ message: 'Authentication token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET_KEY!, (err, decoded) => {
    if (err) {
      return res.status(403).json({ message: 'Invalid or expired token' });
    }

    const decodedPayload = decoded as jwt.JwtPayload;
    const userId = decodedPayload.publicKey || decodedPayload.userId;

    if (!userId) {
      return res.status(403).json({ message: 'Could not extract user ID from token' });
    }

    (req as AuthenticatedRequest).authenticatedUserId = userId;
    next(); // Go to next middleware
  });
};

// User must have payment profile as unique identifier to manage payment and esim subcription
app.post('/create-payment-profile', async (req: Request, res: Response) => {
  try {
    const { publicKey, privateKey } = await solanaService.createNewSolanaWallet();
    const paymentProfile: PaymentProfile = {
      publicKey,
      privateKey,
      createdAt: '',
      updatedAt: ''
    }

    await db.ref(`/payment_profiles/${publicKey}`).set(paymentProfile);
    
    res.status(201).json({ publicKey });
  } catch (error: any) {
    console.error("Error creating payment profile:", error);
    res.status(500).json({ error: "Failed to create payment profile" });
  }
});

export async function updatePaymentProfileWithOrder(ppPublicKey: string, orderId: string): Promise<void> {
  try {
    const paymentProfileRef = db.ref(`/payment_profiles/${ppPublicKey}`);
    const paymentProfileSnapshot = await paymentProfileRef.once('value');
    const currentPaymentProfileData = paymentProfileSnapshot.val() || {};

    let orderIds: string[] = currentPaymentProfileData.orderIds || [];
    orderIds.push(orderId);

    await paymentProfileRef.update({ orderIds });
  } catch (error) {
    console.error('Error updating payment profile with order:', error);
    throw error;
  }
}

app.post('/order', async (req: Request, res: Response) => {
  const orderId = uuidv4();
  console.log(orderId) // Generate a unique order ID containing 20 characters
  const { ppPublicKey, quantity, package_id, package_price } = req.body

  // Now that Firebase is initialized, initialize services that depend on it.
  esimService = new EsimService(db); // Initialize EsimService with the db instance

  const order: Order = {
    orderId,
    ppPublicKey,
    quantity,    
    package_id,    
    package_price,
    paymentReceived: false,
    paidToMaster: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'pending',
  };
  await db.ref(`/orders/${orderId}`).set(order);

  await addOrderToPaymentProfile(ppPublicKey, orderId);

  const paymentCheckDuration = 600000; // 10 minutes
  const pollingInterval = 30000; // Poll every 10 seconds
  const startTime = Date.now();

  const paymentCheckInterval = setInterval(async () => {
    // Check if the total duration has passed
    if (Date.now() - startTime > paymentCheckDuration) {
      console.log(`Payment check duration exceeded for order ${orderId}. Stopping polling.`);
      clearInterval(paymentCheckInterval);
      const latestOrderSnapshot = await db.ref(`/orders/${orderId}`).once('value');
      const latestOrder = latestOrderSnapshot.val() as Order;
      if (latestOrder && !latestOrder.paymentReceived) {
          await db.ref(`/orders/${orderId}`).update({ status: 'failed', updatedAt: new Date().toISOString() });
      }
      return;
    }

    const currentOrderSnapshot = await db.ref(`/orders/${orderId}`).once('value');
    const currentOrder = currentOrderSnapshot.val() as Order;

    // If order doesn't exist or is already paid/processed, stop polling
    if (!currentOrder || currentOrder.paymentReceived) {
        clearInterval(paymentCheckInterval);
        return;
    }

    try {
      // Check if payment was received
      const { enoughReceived, solBalance } = await solanaService.checkSolanaPayment(order.ppPublicKey, order.package_price);
      order.paymentInSol = solBalance;
      console.log(`processing order ${order.orderId}`, enoughReceived, solBalance)
      if (enoughReceived) {
        console.log(`Payment received for order ${orderId}.`);
        clearInterval(paymentCheckInterval);
        return;
      }

      try {
        // Check if payment was received
        const { enoughReceived, solBalance } = await solanaService.checkSolanaPayment(order.ppPublicKey, order.package_price);
        order.paymentInSol = solBalance;
        console.log(`processing order ${order.orderId}`, enoughReceived, solBalance)
        if (enoughReceived) {
          console.log(`Payment received for order ${orderId}.`);
          clearInterval(paymentCheckInterval);

        // Only proceed if payment hasn't been processed by another check instance (unlikely but good practice)
        if (!latestOrder.paymentReceived) {
          latestOrder.paymentReceived = true;
          latestOrder.updatedAt = new Date().toISOString(); // Update timestamp
          latestOrder.status = 'paid'; // Update status
          // const sim = await esimService.placeOrder({ quantity, package_id });
          const sim = null
          latestOrder.sim = sim

          // Only proceed if payment hasn't been processed by another check instance (unlikely but good practice)
          if (!latestOrder.paymentReceived) {
            latestOrder.paymentReceived = true;
            const sim = await esimService.placeOrder({ quantity, package_id });
            latestOrder.sim = sim

        // handle aggregation of payment to master wallet
        // should handle failed case 
        if (latestOrder.paymentReceived) {
          const privateKey = paymentProfileSnapshot.val().privateKey;
          const sig = await solanaService.aggregatePaymentToMasterWallet(privateKey, parseFloat(order.package_price));
          if (sig) {
            latestOrder.paidToMaster = true;
            latestOrder.updatedAt = new Date().toISOString(); // Update timestamp
            latestOrder.status = 'paid_to_master'; // Update status
            await db.ref(`/orders/${orderId}`).set(latestOrder);
          } else {
            console.error(`Failed to aggregate payment to master wallet for order ${orderId}.`);
            latestOrder.updatedAt = new Date().toISOString(); // Update timestamp
            latestOrder.status = 'failed'; // Update status
            await db.ref(`/orders/${orderId}`).set(latestOrder);
          }
        }
      } catch (error) {
        console.error(`Error processing order payment for order ${orderId}:`, error);
        // Depending on error handling requirements, you might want to stop the interval here
        clearInterval(paymentCheckInterval)
      }
    } catch (error) {
      console.error(`Error processing order payment for order ${orderId}:`, error);
      // Depending on error handling requirements, you might want to stop the interval here
      clearInterval(paymentCheckInterval)
       // Optionally update order status to failed here as well
       const latestOrderSnapshot = await db.ref(`/orders/${orderId}`).once('value');
       const latestOrder = latestOrderSnapshot.val() as Order;
       latestOrder.updatedAt = new Date().toISOString(); // Update timestamp
       latestOrder.status = 'failed'; // Update status
       await db.ref(`/orders/${orderId}`).set(latestOrder);
    }
  }, pollingInterval);

    res.json({ orderId });
  });

  // to be routinely called by front-end to check if order has been fulfilled
  app.get('/order/:orderId', async (req: Request, res: Response) => {
    const { orderId } = req.params;
    const orderSnapshot = await db.ref(`/orders/${orderId}`).once('value');
    const order = orderSnapshot.val() as Order;

    if (!orderSnapshot.exists()) {
      res.status(404).json({ message: 'Order not found' });
    }

    if (order.paymentReceived && order.sim.iccid) {
      res.json({
        orderId: order.orderId,
        paymentReceived: order.paymentReceived,
        sim: order.sim
      });
    }
    else {
      res.status(204).send(); // Send a 204 status with no body
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

      const packages = await esimService.getPackagePlans(packageType, country as string);

      if (packages === undefined) {
        // This case is handled in the service by returning undefined on error
        return res.status(500).json({ error: 'Failed to retrieve package plans' });
      }

      res.json(packages);

    } catch (error: any) {
      console.error("Error in /packages endpoint:", error);
      res.status(500).json({ error: "Failed to retrieve package plans" });
    }
  });

  // Health check endpoint
  app.get('/health', (req, res) => {
    res.send("OK");
  });

  const port = parseInt(process.env.PORT || '3000');
  app.listen(port, () => {
    console.log(`listening on port ${port}`);
  });
}

// Call the main async function to start the application
main().catch(console.error);
