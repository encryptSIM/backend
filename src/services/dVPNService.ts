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

  decodeCredentialsPayload(payload: string) {
    const buffer = Buffer.from(payload, 'base64');

    if (buffer.length !== 58) {
      throw new Error('Payload must be exactly 58 bytes');
    }

    // IP Address: bytes 0-3
    const ipAddress = `${buffer[0]}.${buffer[1]}.${buffer[2]}.${buffer[3]}/32`;

    // Host: bytes 20-23
    const host = `${buffer[20]}.${buffer[21]}.${buffer[22]}.${buffer[23]}`;

    // Listen Port: bytes 24-25, Big Endian UInt16
    const listenPort = buffer.readUInt16BE(24);

    // Endpoint
    const endpoint = `${host}:${listenPort}`;

    // Peer Public Key: bytes 26-57
    const peerPubKey = buffer.slice(26, 58).toString('base64');

    return {
      ipAddress,
      host,
      listenPort,
      endpoint,
      peerPubKey,
    };
  }

  buildWireGuardConf(data: any) {
    const privateKey = data.private_key || '';
    const dns = data.dns || '1.1.1.1';

    const decodePayloadData = this.decodeCredentialsPayload(data.payload);

    return {
      Interface: {
        PrivateKey: privateKey,
        Address: decodePayloadData.ipAddress,
        DNS: dns,
      },
      Peer: {
        PublicKey: decodePayloadData.peerPubKey,
        Endpoint: decodePayloadData.endpoint,
        AllowedIPs: "0.0.0.0/0",
        PersistentKeepalive: 20,
      }
    };
  }
}