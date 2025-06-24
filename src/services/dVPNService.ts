import axios from 'axios';

const DVPN_BASE_URL = 'https://api.dvpnsdk.com';

export class DVPNService {
  private dvpnApiKey: string;

  constructor() {
    const dvpnApiKey = process.env.DVPN_API_KEY;

    if (!dvpnApiKey) {
      throw new Error('DVPN_API_KEY environment variable is not set.');
    }

    this.dvpnApiKey = dvpnApiKey;
  }

  public async getHealth() {
    return axios.get(`${DVPN_BASE_URL}/health`);
  }

  async getConfig() {
    return axios.get(`${DVPN_BASE_URL}/config`, {
      params: { app_token: this.dvpnApiKey },
    });
  }

  async createDevice(platform?: string) {
    const res = await axios.post(`${DVPN_BASE_URL}/device`, {
      platform: !!platform ? platform : '',
      app_token: this.dvpnApiKey,
    });
    return res.data;
  }

  async getCountries(deviceToken: string) {
    const res = await axios.get(`${DVPN_BASE_URL}/country?filter=WIREGUARD`, {
      headers: { 'x-device-token': deviceToken },
    });
    return res.data;
  }

  async getCities(deviceToken: string, countryId: string) {
    const res = await axios.get(`${DVPN_BASE_URL}/country/${countryId}/city`, {
      headers: {
        'x-device-token': deviceToken,
      },
      params: {
        filter: 'WIREGUARD',
      },
    });

    return res.data;
  }

  async getServers(deviceToken: string, cityId: string) {
    const res = await axios.get(`${DVPN_BASE_URL}/city/${cityId}/server?filter=WIREGUARD`, {
      headers: { 'x-device-token': deviceToken },
    });
    return res.data;
  }

  async createServerCredentials(deviceToken: string, serverId: string) {
    const res = await axios.post(`${DVPN_BASE_URL}/server/${serverId}/credentials`, {}, {
      headers: { 'x-device-token': deviceToken },
    });
    return res.data;
  }

  buildWireGuardConf(data: any) {
    const privateKey = data.private_key || '';
    const address = data.address || '10.0.0.2/32';
    const dns = data.dns || '1.1.1.1';

    const serverPublicKey = data.server_public_key || '';

    let endpoint = '';
    if (data.remote_url) {
      endpoint = data.remote_url.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '');
    } else if (data.server?.remote_url) {
      endpoint = data.server.remote_url.replace(/^https?:\/\//, '').replace(/^wss?:\/\//, '');
    } else {
      endpoint = 'endpoint.example.com:51820';
    }

    return `[Interface]
    PrivateKey = ${privateKey}
    Address = ${address}
    ListenPort = 51820
    DNS = ${dns}
    
    [Peer]
    PublicKey = ${serverPublicKey}
    Endpoint = ${endpoint}
    AllowedIPs = 0.0.0.0/0
    PersistentKeepalive = 20
    `;
  }
}