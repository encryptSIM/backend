import { Request, Response } from 'express';
import admin from "firebase-admin";
import { v4 as uuidv4 } from 'uuid';
import { SolanaService } from './services/solanaService';
import { AiraloWrapper, SimOrder } from './services/airaloService';
import { DBHandler, GCloudLogger } from './helper';
import { da } from '@faker-js/faker/.';

interface Order {
  orderId: string;
  ppPublicKey: string;
  quantity: number;
  package_id: string;
  package_price: string;
  paymentInSol?: number;
  sim?: SimOrder;
  createdAt: string;
  updatedAt: string;
  status: 'pending' | 'paid' | 'esim_provisioned' | 'paid_to_master' | 'failed';
  errorLog?: string
}

export class OrderHandler {
  private db: admin.database.Database;
  private dbHandler: DBHandler;
  private solanaService: SolanaService;
  private airaloWrapper: AiraloWrapper;
  private paymentCheckDuration = 600000; // 10 minutes
  private pollingInterval = 30000; // Poll every 10 seconds
  private logger: GCloudLogger

  constructor(
    db: admin.database.Database,
    solanaService: SolanaService,
    airaloWrapper: AiraloWrapper,
    logger: GCloudLogger
  ) {
    this.db = db;
    this.solanaService = solanaService;
    this.airaloWrapper = airaloWrapper;
    this.dbHandler = new DBHandler(this.db);
    this.logger = logger;
  }

  public queryPPOrder = async (req: Request, res: Response) => {
    const { ppPublicKey } = req.params;
    const paymentProfileSnapshot = await this.db.ref(`/payment_profiles/${ppPublicKey}`).once('value');
    if (!paymentProfileSnapshot.exists()) {
      return res.status(400).json({ error: 'payment profile not found' });
    }
    const paymentProfileData = paymentProfileSnapshot.val();

    const orderIdsObject = paymentProfileData.orderIds || {};
    const orderIds = [...new Set(Object.values(orderIdsObject))];

    if (!orderIdsObject || Object.keys(orderIdsObject).length === 0) {
      console.log(`No orders found associated with payment profile: ${ppPublicKey}`);
      return res.status(200).json([]);
    }

    const orderDetailsPromises = orderIds.map((orderId: string) =>
      this.getOrder(orderId).catch(err => {
        this.logger.logERROR(`Error fetching order ${orderId}: ${err}`);
        return null;
      })
    );

    const orders = (await Promise.all(orderDetailsPromises))
      .filter(order => order !== null);

    let cleanedData = [];

    for (const order of orders) {
      if (order && typeof order === 'object' && 'orderId' in order && 'package_id' in order && 'sim' in order) {
        const usageData = await this.airaloWrapper.getDataUsage(order.sim.iccid);
        const newObj = {};
        newObj["orderId"] = order.orderId;
        newObj["package_id"] = order.package_id;
        newObj["iccid"] = order.sim.iccid;
        newObj["usage_data"] = usageData;
        cleanedData.push(newObj);
      }
    }

    console.log("Simplified Orders: ", cleanedData);

    return res.status(200).json(cleanedData);
  }

  public queryOrder = async (req: Request, res: Response) => {
    const { orderId } = req.params;
    const order = await this.getOrder(orderId)

    if (!order) {
      return res.status(404).json({ message: 'Order not found' });
    }

    if (order.status === 'esim_provisioned') {
      return res.status(200).json({
        orderId: order.orderId,
        status: order.status,
        sim: order.sim
      });
    }

    this.logger.logDEBUG(`order ${order.orderId}: esim not provisioned`)

    return res.status(200).json({
      orderId: order.orderId,
      status: order.status
    })
  }

  // add past order to payment profile
  public addOrder = async (req: Request, res: Response) => {
    try {
      const { ppPublicKey, iccid } = req.body;

      if (!iccid || !ppPublicKey) {
        return res.status(400).json({ error: 'Missing required parameters' });
      }

      // Check if the payment profile exists
      const paymentProfileSnapshot = await this.db.ref(`/payment_profiles/${ppPublicKey}`).once('value');
      if (!paymentProfileSnapshot.exists()) {
        return res.status(400).json({ error: 'Payment profile not found' });
      }

      const orderId = uuidv4();

      // Create a minimal order object matching the Order interface structure
      const order: Order = {
        orderId,
        ppPublicKey,
        quantity: 0, // Default or empty value
        package_id: '', // Default or empty value
        package_price: '', // Default or empty value
        paymentInSol: 0, // Default or empty value
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        status: 'esim_provisioned', // Assuming the eSIM is already provisioned
        //@ts-ignore
        sim: { // Include sim object matching the SimOrder interface structure
          iccid: iccid,
          qrcode: '', // Default or empty value to match SimOrder interface
          qrcode_url: '', // Default or empty value to match SimOrder interface
          created_at: '', // Default or empty value to match SimOrder interface
          direct_apple_installation_url: '', // Default or empty value (optional in SimOrder)
        }
      };

      // Save the order to the /orders path
      await this.db.ref(`/orders/${orderId}`).set(order);

      // Update the payment profile with the new orderId
      await this.dbHandler.updatePPOrder(order.ppPublicKey, order.orderId);

      this.logger.logINFO(`Order ${orderId} added for payment profile ${ppPublicKey} with ICCID ${iccid}`);

      return res.status(200).json({ message: 'Order added successfully', orderId: orderId });

    } catch (error: any) {
      this.logger.logERROR(`Error adding order: ${error}`);
      return res.status(500).json({ error: 'Failed to add order' });
    }
  };

  public createOrder = async (req: Request, res: Response) => {
    const orderId = uuidv4();
    const { ppPublicKey, quantity, package_id, package_price } = req.body;

    // Check if the payment profile exists
    const paymentProfileSnapshot = await this.db.ref(`/payment_profiles/${ppPublicKey}`).once('value');
    if (!paymentProfileSnapshot.exists()) {
      return res.status(400).json({ error: 'payment profile not found' });
    }

    const parsedUSD = parseFloat(package_price)
    const paymentInSol = await this.solanaService.convertUSDToSOL(parsedUSD)

    const order: Order = {
      orderId,
      ppPublicKey,
      quantity,
      package_id,
      package_price,
      paymentInSol,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'pending',
    };
    await this.db.ref(`/orders/${orderId}`).set(order);

    const startTime = Date.now();
    const paymentCheckInterval = setInterval(async () => {
      let order = await this.getOrder(orderId)
      // Check if the total duration has passed
      if (Date.now() - startTime > this.paymentCheckDuration) {
        console.log(`Payment check duration exceeded for order ${orderId}. Stopping polling.`);
        order = await this.updateOrderStatus(order, "failed")
        clearInterval(paymentCheckInterval);
        return;
      }

      try {
        // re-fetch order and pp for this cycle
        const pp = await this.dbHandler.getPaymentProfile(order.ppPublicKey)

        // check payment has been received
        if (order.status === 'pending') {
          order = await this.processPayment(order)
        }

        // if payment has been received, pay to master
        if (order.status === 'paid') {
          order = await this.payToMaster(order, pp);
        }

        // if paid_to_master, provision esim
        if (order.status === 'paid_to_master') {
          order = await this.provisionEsim(order);
        }

        // if esim provisioned, end this cycle
        if (order.status === 'esim_provisioned') {
          clearInterval(paymentCheckInterval);
        }
      }
      catch (error) {
        this.logger.logERROR(`Error processing order payment for order ${orderId}: ${error}`);
        // Depending on error handling requirements, you might want to stop the interval here
        await this.setOrderError(orderId, error);
        clearInterval(paymentCheckInterval);
      }
    }, this.pollingInterval)

    return res.json({
      orderId,
      paymentInSol
    });
  }

  // === HELPER FUNCTION ===
  public async payToMaster(order: Order, pp: any): Promise<Order> {
    const sig = await this.solanaService.aggregatePaymentToMasterWallet(pp.privateKey, order.paymentInSol);
    if (sig) {
      await this.updateOrderStatus(order, 'paid_to_master')
    }

    return order
  }

  public async provisionEsim(order: Order): Promise<Order> {
    // get order
    //@ts-ignore
    const sim = await this.airaloWrapper.placeOrder({
      quantity: order.quantity,
      package_id: order.package_id
    });
    order.sim = sim;
    order = await this.updateOrderStatus(order, "esim_provisioned")
    await this.dbHandler.updatePPOrder(order.ppPublicKey, order.orderId)

    return order
  }

  public async processPayment(order: Order): Promise<Order> {
    const enoughReceived = await this.solanaService.checkSolanaPayment(order.ppPublicKey, order.paymentInSol);
    console.log(`processing order ${order.orderId}`, enoughReceived, order.paymentInSol);
    if (enoughReceived) {
      console.log(`Payment received for order ${order.orderId}.`);
      order = await this.updateOrderStatus(order, 'paid');
    }

    return order;
  }

  public async updateOrderStatus(order: Order, status: 'pending' | 'paid' | 'esim_provisioned' | 'paid_to_master' | 'failed'): Promise<Order> {
    order.status = status;
    order.updatedAt = new Date().toISOString();
    await this.db.ref(`/orders/${order.orderId}`).set(order);

    return order
  }

  public async getOrder(order_id: string): Promise<Order> {
    const orderSnapshot = await this.db.ref(`/orders/${order_id}`).once('value');

    if (!orderSnapshot.exists()) {
      return null
    }

    return orderSnapshot.val() as Order;
  }

  private async setOrderError(order_id: string, errorLog: string): Promise<void> {
    const order = await this.getOrder(order_id);
    if (order) {
      order.errorLog = errorLog
      order.updatedAt = new Date().toISOString();
      await this.db.ref(`/orders/${order.orderId}`).set(order);
    }
  }
} 
