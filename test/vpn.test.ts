import { config } from "dotenv";

config()

const API_URL = 'http://localhost:3000'; // Assuming your app runs on this port

describe('vpn', () => {
  let deviceToken = '';

  // npm test -- -t "vpn-create-device"
  it('vpn-create-device', async () => {
    // call API to create device
    const createDeviceResponse = await fetch(`${API_URL}/vpn/create-device`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    expect(createDeviceResponse.ok).toBe(true);
    const orderResponseDataData = await createDeviceResponse.json();
    console.log(`orderResponseData: ${orderResponseDataData}`)
    // const orderId = orderResponseDataData.orderId;
  }, 5 * 60 * 1000)

  // npm test -- -t "full-integration"
  it('vpn-full-integration', async () => {
    // 3. Assert the final status
    // expect(orderStatus).toBeDefined();
    // expect(orderStatus?.orderId).toBe(orderId);
    // expect(orderStatus?.status).toBe('esim_provisioned');
    // expect(orderStatus?.sim).toBeDefined();

  }, 11 * 60 * 1000); // Set Jest timeout for the test case to be longer than the polling timeout
});