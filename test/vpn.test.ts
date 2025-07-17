import { config } from "dotenv";

config()

const API_URL = 'http://localhost:3000'; // Assuming your app runs on this port
const DEFAULT_DEVICE_TOKEN = '8glbgy9r9bubrr2h2id7n9i6yv3r5dpsdsko221ssu48t0proeifkcnkxqxeqg7bavy9z7fgg1as5r1w71rd8tv8g6jo7upt';
const DEFAULT_COUNTRY_ID = 'c1a203e3-2335-4a12-9b0a-52d0eebc623a';
const DEFAULT_CITY_ID = 'b1284eca-6962-438e-879a-1ddc1596827d';
const DEFAULT_SERVER_ID = 'b56d6063-8514-4645-8d51-41be26b7d0ad';

// npm test -- test/vpn.test.ts
describe('vpn', () => {
  let deviceToken = DEFAULT_DEVICE_TOKEN;
  let countryId = DEFAULT_COUNTRY_ID;
  let cityId = DEFAULT_CITY_ID;
  let serverId = DEFAULT_SERVER_ID;

  // npm test -- test/vpn.test.ts -t "vpn-create-device"
  it('vpn-create-device', async () => {
    // call API to create device
    const createDeviceResponse = await fetch(`${API_URL}/vpn/create-device`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    expect(createDeviceResponse.ok).toBe(true);
    const createDeviceResponseData = (await createDeviceResponse.json()).data;
    console.log("createDeviceResponseData: ", createDeviceResponseData);

    expect(createDeviceResponseData.token).toBeDefined();
    expect(createDeviceResponseData.is_activated).toBe(true);
    expect(createDeviceResponseData.is_banned).toBe(false);

    deviceToken = createDeviceResponseData.token;
    console.log("deviceToken: ", deviceToken);
  }, 5 * 60 * 1000)

  // npm test -- test/vpn.test.ts -t "vpn-get-countries"
  it('vpn-get-countries', async () => {
    // call API to get countries
    const countriesResponse = await fetch(`${API_URL}/vpn/countries/${deviceToken}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    expect(countriesResponse.ok).toBe(true);
    const countriesResponseData = (await countriesResponse.json()).data;
    console.log("countriesResponseData: ", countriesResponseData);

    expect(countriesResponseData.length).toBeGreaterThan(0);

    const randomCountry = countriesResponseData[Math.floor(Math.random() * countriesResponseData.length)];

    expect(randomCountry.id).toBeDefined();
    expect(randomCountry.name).toBeDefined();
    expect(randomCountry.code).toBeDefined();
    expect(randomCountry.servers_available).toBeGreaterThan(0);

    countryId = randomCountry.id;
    console.log("countryId: ", countryId);
  }, 5 * 60 * 1000)

  // npm test -- test/vpn.test.ts -t "vpn-get-cities"
  it('vpn-get-cities', async () => {
    // call API to get cities
    const citiesResponse = await fetch(`${API_URL}/vpn/cities/${countryId}?deviceToken=${deviceToken}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    expect(citiesResponse.ok).toBe(true);
    const citiesResponseData = (await citiesResponse.json()).data;
    console.log("citiesResponseData: ", citiesResponseData);

    expect(citiesResponseData.length).toBeGreaterThan(0);

    const randomCity = citiesResponseData[Math.floor(Math.random() * citiesResponseData.length)];

    expect(randomCity.id).toBeDefined();
    expect(randomCity.country_id).toBeDefined();
    expect(randomCity.name).toBeDefined();
    expect(randomCity.servers_available).toBeGreaterThan(0);

    cityId = randomCity.id;
    console.log("cityId: ", cityId);
  }, 5 * 60 * 1000)

  // npm test -- test/vpn.test.ts -t "vpn-get-servers"
  it('vpn-get-servers', async () => {
    // call API to get servers
    const serversResponse = await fetch(`${API_URL}/vpn/servers/${cityId}?deviceToken=${deviceToken}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    expect(serversResponse.ok).toBe(true);
    const serversResponseData = (await serversResponse.json()).data;
    console.log("serversResponseData: ", serversResponseData);

    expect(serversResponseData.length).toBeGreaterThan(0);

    const randomServer = serversResponseData[Math.floor(Math.random() * serversResponseData.length)];

    expect(randomServer.id).toBeDefined();
    expect(randomServer.is_available).toBe(true);
    expect(randomServer.load).toBeDefined();
    expect(randomServer.version).toBeDefined();
    expect(randomServer.remote_url).toBeDefined();
    expect(randomServer.protocol).toBe('WIREGUARD');

    serverId = randomServer.id;
    console.log("serverId: ", serverId);
  }, 5 * 60 * 1000)

  // npm test -- test/vpn.test.ts -t "vpn-create-server-credentials"
  it('vpn-create-server-credentials', async () => {
    // call API to create server-credentials
    const serverCredentialsResponse = await fetch(`${API_URL}/vpn/create-credentials/${serverId}?deviceToken=${deviceToken}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    expect(serverCredentialsResponse.ok).toBe(true);
    const serverCredentials = await serverCredentialsResponse.json();
    console.log("serverCredentials: ", serverCredentials);

    const credentialsData = serverCredentials.credentials.data;

    expect(credentialsData.payload).toBeDefined();
    expect(credentialsData.private_key).toBeDefined();
  }, 5 * 60 * 1000)

  // npm test -- test/vpn.test.ts -t "vpn-full-integration"
  it('vpn-full-integration', async () => {
    // call the API to execute all required steps automatically and returns the VPN configuration.
    const activeVPNConfigResponse = await fetch(`${API_URL}/vpn/active`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    expect(activeVPNConfigResponse.ok).toBe(true);
    const activeVPNConfigResponseData = await activeVPNConfigResponse.json();
    console.log("activeVPNConfigResponseData: ", activeVPNConfigResponseData);

  }, 11 * 60 * 1000); // Set Jest timeout for the test case to be longer than the polling timeout
});