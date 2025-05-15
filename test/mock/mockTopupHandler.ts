import { TopupOrder } from "../../src/topup-handler";
import { AiraloTopupOrder } from "../../src/services/airaloService";
import admin from "firebase-admin";
import { DBHandler } from '../../src/helper';

// Assuming the structure of asialink-7days-1gb-topup.json matches the AiraloTopupOrder interface
import mockTopupData from "../mock-data/asialink-7days-1gb-topup.json";

export class MockTopupHandler {
    private db: admin.database.Database;
    private dbHandler: DBHandler;

    constructor(db: admin.database.Database) {
        this.db = db;
        this.dbHandler = new DBHandler(this.db);
    }

    public async provisionEsim(order: TopupOrder): Promise<TopupOrder> {
        console.log("Mock provisionEsim called with order:", order);

        // Simulate the response from airaloWrapper.createTopupOrder using mock data
        const mockTopup: AiraloTopupOrder = {
            id: mockTopupData.data.id.toString(), // Assuming id is a number in the json, convert to string if AiraloTopupOrder expects string
            package_id: mockTopupData.data.package_id,
            currency: mockTopupData.data.currency,
            quantity: mockTopupData.data.quantity,
            description: mockTopupData.data.description,
            esim_type: mockTopupData.data.esim_type,
            data: mockTopupData.data.data,
            price: mockTopupData.data.price,
            net_price: mockTopupData.data.net_price,
        };

        // Update the order object as the original function does
        order.topup = mockTopup;
        order.status = "esim_provisioned";
        order.updatedAt = new Date().toISOString(); // Simulate updating the timestamp

        // store order into database
        await this.db.ref(`/topup_orders/${order.orderId}`).set(order);
        await this.dbHandler.updatePPOrder(order.ppPublicKey, order.orderId);

        console.log("Mock provisionEsim returning order:", order);

        return order;
    }
}