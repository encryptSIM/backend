import { Request, Response } from 'express';
import admin from "firebase-admin";
import { v4 as uuidv4 } from 'uuid';
import { SolanaService } from './services/solanaService';
import { AiraloWrapper, AiraloTopupOrder } from './services/airaloService';
import { DBHandler } from './helper';
import { MockTopupHandler } from '../test/mock/mockTopupHandler';

export interface TopupOrder {
    orderId: string;
    ppPublicKey: string;
    iccid: string;
    quantity: number;
    package_id: string;
    package_price: string;
    paymentInSol?: number;
    topup?: AiraloTopupOrder;
    createdAt: string;
    updatedAt: string;
    status: 'pending' | 'paid' | 'esim_provisioned' | 'paid_to_master' | 'failed';
    errorLog?: string
}

export class TopupHandler {
    private db: admin.database.Database;
    private dbHandler: DBHandler;
    private solanaService: SolanaService;
    private airaloWrapper: AiraloWrapper;
    private paymentCheckDuration = 600000;
    private pollingInterval = 30000;

    constructor(db: admin.database.Database, solanaService: SolanaService, airaloWrapper: AiraloWrapper) {
        this.db = db;
        this.solanaService = solanaService;
        this.airaloWrapper = airaloWrapper;
        this.dbHandler = new DBHandler(this.db);
    }

    public queryPPTopupOrder = async (req: Request, res: Response) => {
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
            this.getTopupOrder(orderId).catch(err => {
                console.error(`Error fetching order ${orderId}:`, err);
                return null;
            })
        );

        const orders = (await Promise.all(orderDetailsPromises))
            .filter(order => order !== null);
        console.log("Orders: ", orders);

        let cleanedData = [];

        for (const order of orders) {
            if (order && typeof order === 'object' && 'orderId' in order && 'package_id' in order && 'iccid' in order) {
                const usageData = await this.airaloWrapper.getDataUsage(order.iccid);
                const newObj = {};
                newObj["orderId"] = order.orderId;
                newObj["package_id"] = order.package_id;
                newObj["iccid"] = order.iccid;
                newObj["usage_data"] = usageData;
                cleanedData.push(newObj);
            }
        }

        console.log("Simplified Topup Orders: ", cleanedData);

        res.status(200).json(cleanedData);//To_do
    }

    public queryTopUpOrder = async (req: Request, res: Response) => {
        const { orderId } = req.params;
        const order = await this.getTopupOrder(orderId);

        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        if (order.status === 'esim_provisioned') {
            return res.status(200).json({
                orderId: order.orderId,
                status: order.status,
                topup: order.topup
            });
        }

        res.status(204).json({
            orderId: order.orderId,
            status: order.status
        })
    }


    public createTopupOrder = async (req: Request, res: Response) => {
        const orderId = uuidv4();
        const { ppPublicKey, package_id, iccid, package_price } = req.body;

        // Check if the payment profile exists
        const paymentProfileSnapshot = await this.db.ref(`/payment_profiles/${ppPublicKey}`).once('value');
        if (!paymentProfileSnapshot.exists()) {
            return res.status(400).json({ error: 'payment profile not found' });
        }

        const parsedUSD = parseFloat(package_price);
        const paymentInSol = await this.solanaService.convertUSDToSOL(parsedUSD);

        const order: TopupOrder = {
            orderId,
            ppPublicKey,
            iccid,
            quantity: 1,
            package_id,
            package_price,
            paymentInSol,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            status: 'pending'
        };

        await this.db.ref(`/topup_orders/${orderId}`).set(order);

        const startTime = Date.now();
        const paymentCheckInterval = setInterval(async () => {
            // Check if the total duration has passed
            if (Date.now() - startTime > this.paymentCheckDuration) {
                clearInterval(paymentCheckInterval);
                return;
            }

            try {
                // re-fetch order and pp for this cycle
                let order = await this.getTopupOrder(orderId)
                const pp = await this.dbHandler.getPaymentProfile(order.ppPublicKey)

                // check payment has been received
                if (order.status === 'pending') {
                    order = await this.processPayment(order)
                }

                // if payment has been received, provisioning esims
                if (order.status === 'paid') {
                    order = await this.payToMaster(order, pp);
                }

                // if esim provisioned, pay to master
                if (order.status === 'paid_to_master') {
                    // order = await this.provisionEsim(order);
                    const mockTopupHandler = new MockTopupHandler(this.db)
                    order = await mockTopupHandler.provisionEsim(order)
                }

                // if paid to master, end this cycle
                if (order.status === 'esim_provisioned') {
                    clearInterval(paymentCheckInterval);
                }
            }
            catch (error) {
                console.error(`Error processing order payment for order ${orderId}:`, error);
                await this.setOrderError(orderId, error as string); // Cast error to string
                clearInterval(paymentCheckInterval);
            }
        }, this.pollingInterval)

        res.json({ orderId, paymentInSol });
    }

    // === HELPER FUNCTION ===
    public async payToMaster(order: TopupOrder, pp: any): Promise<TopupOrder> {
        const sig = await this.solanaService.aggregatePaymentToMasterWallet(pp.privateKey, order.paymentInSol);
        if (sig) {
            await this.updateOrderStatus(order, 'paid_to_master')
        }

        return order
    }

    public async provisionEsim(order: TopupOrder): Promise<TopupOrder> {
        // get order
        const topup = await this.airaloWrapper.createTopupOrder({
            iccid: order.iccid,
            package_id: order.package_id
        });
        order.topup = topup;
        order = await this.updateOrderStatus(order, "esim_provisioned")
        await this.dbHandler.updatePPOrder(order.ppPublicKey, order.orderId)

        return order
    }

    public async processPayment(order: TopupOrder): Promise<TopupOrder> {
        const enoughReceived = await this.solanaService.checkSolanaPayment(order.ppPublicKey, order.paymentInSol);
        console.log(`processing order ${order.orderId}`, enoughReceived);
        if (enoughReceived) {
            console.log(`Payment received for order ${order.orderId}.`);
            order = await this.updateOrderStatus(order, 'paid');
            console.log("order: ", order.status);
        }

        return order;
    }

    public async updateOrderStatus(order: TopupOrder, status: 'pending' | 'paid' | 'esim_provisioned' | 'paid_to_master' | 'failed'): Promise<TopupOrder> {
        order.status = status;
        order.updatedAt = new Date().toISOString();
        await this.db.ref(`/topup_orders/${order.orderId}`).set(order);

        return order
    }

    public async getTopupOrder(order_id: string): Promise<TopupOrder> {
        const orderSnapshot = await this.db.ref(`/topup_orders/${order_id}`).once('value');

        if (!orderSnapshot.exists()) {
            return null
        }
        return orderSnapshot.val() as TopupOrder;
    }

    private async setOrderError(order_id: string, errorLog: string): Promise<void> {
        const order = await this.getTopupOrder(order_id)
        if (order) {
            order.errorLog = errorLog
            order.updatedAt = new Date().toISOString();
            await this.db.ref(`/topup_orders/${order.orderId}`).set(order);
        }
    }
}
