import { describe, expect, it } from '@jest/globals';

import { SolanaService } from '../src/services/solanaService';
import { DBHandler, initializeFirebase } from '../src/helper';
import { config } from "dotenv";
import { TopupHandler, TopupOrder } from "../src/topup-handler";
import { v4 as uuidv4 } from 'uuid';

config();
const testPublicKey = 'Fip7DsE6uA9tgQcatYkWQEYfyCmcoYPSrCoTPr2SbE76'; // ppPublicKey from your sample

describe('TopupHandler Tests', () => { // Changed describe to be more general for topup tests

  //npm test -- -t create-topup-order
  it('create-topup-order', async () => {
    const orderId = uuidv4();
    const { database } = await initializeFirebase();
    console.log("OrderId: ", orderId);
    const solanaService = new SolanaService(null);
    const sol = await solanaService.convertUSDToSOL(5);
    const order: TopupOrder = {
      orderId: orderId,
      ppPublicKey: "Fip7DsE6uA9tgQcatYkWQEYfyCmcoYPSrCoTPr2SbE76",
      iccid: "89852351124640198082",
      quantity: 1,
      package_id: "asialink-7days-1gb-topup",
      paymentInSol: sol,
      package_price: "5",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'pending'
    };

    await database.ref(`/topup_orders/${orderId}`).set(order);
  }, 5 * 60 * 1000);

  //npm test -- -t topup-handler
  it('topup-handler', async () => {
    const { database } = await initializeFirebase();
    const solanaService = new SolanaService(null);

    const order_id = "b7338341-e3e1-4bd2-9006-61ab015e1031";

    const topup = new TopupHandler(database, solanaService, null, null);

    let order = await topup.getTopupOrder(order_id);
    order = await topup.processPayment(order);
    expect(order.status).toBe('paid');

  }, 5 * 60 * 1000);
});

