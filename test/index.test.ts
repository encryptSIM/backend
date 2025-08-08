import admin from 'firebase-admin';
import * as dotenv from 'dotenv';
import { OrderHandler } from '../src/order-handler';
import { DBHandler, initializeFirebase } from '../src/helper';

dotenv.config();

describe('updatePaymentProfileWithOrder', () => {
  const ppPublicKey = 'testPublicKeyMultiOrders';
  let paymentProfilesRef: admin.database.Reference; // Declare ref here
  let testRef: admin.database.Reference; // Declare testRef here
  let orderHandler: OrderHandler;
  let dbHandler: DBHandler;

  // Helper function to get the orderIds array from the database
  async function getOrderIds(): Promise<string[]> {
    const snapshot = await testRef.once('value');
    if (snapshot.exists() && snapshot.hasChild('orderIds')) {
      return snapshot.val().orderIds;
    } else {
      return [];
    }
  }

  beforeEach(async () => {
    // Initialize Firebase and get db instance
    const { database } = await initializeFirebase();
    orderHandler = new OrderHandler(database, null, null, null);
    dbHandler = new DBHandler(database);

    // Define references after db is initialized
    paymentProfilesRef = database.ref('payment_profiles');
    testRef = paymentProfilesRef.child(ppPublicKey); // Reference to the test location

    if (testRef) {
      // Clear any existing data in the test location before each test
      await testRef.remove().catch(error => {
        console.error("Error during cleanup:", error);
      });
    }
  });

  it('should correctly add multiple orderIds to orderIds array', async () => {
    const orderIdsToAdd = ['orderId1', 'orderId2', 'orderId3'];
    const initialOrderIds = ['existingOrderId1', 'existingOrderId2'];

    // Set initial data
    await testRef.set({ orderIds: initialOrderIds });

    // Add each orderId sequentially
    for (const orderId of orderIdsToAdd) {
      await dbHandler.updatePPOrder(ppPublicKey, orderId);
    }

    const snapshot = await testRef.once('value');
    const data = snapshot.val();

    expect(snapshot.exists()).toBe(true);
    expect(data.orderIds.length).toBe(initialOrderIds.length + orderIdsToAdd.length);
    expect(data.orderIds).toEqual([...initialOrderIds, ...orderIdsToAdd]);
  });

  it('should create orderIds array and add orderId if it does not exist', async () => {
    const orderId = 'testOrderId';
    await dbHandler.updatePPOrder(ppPublicKey, orderId);
    const orderIds = await getOrderIds();

    expect(orderIds).toEqual([orderId]);
  });

  afterEach(async () => {
    // Clean up any data left in the test location after each test
    await testRef.remove().catch(error => {
      console.error("Error during cleanup:", error);
    });
  });

});
