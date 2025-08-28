import { Router } from 'express';
import { Services } from '../index';

export default function vpnRoutes(services: Services): Router {
  const router = Router();
  const { dVPNService, logger } = services;

  // Create device
  router.post('/create-device', async (req, res) => {
    try {
      const deviceInfo = await dVPNService.createDevice();
      logger.logINFO(`deviceInfo: ${JSON.stringify(deviceInfo)}`);

      return res.json({
        data: deviceInfo.data,
      });
    } catch (err: any) {
      logger.logERROR(err?.response?.data || err);
      res.status(500).json({ error: 'Failed to create device' });
    }
  });

  // Get countries
  router.get('/countries/:deviceToken', async (req, res) => {
    try {
      const { deviceToken } = req.params;

      const countries = await dVPNService.getCountries(deviceToken);
      logger.logINFO(`countries: ${JSON.stringify(countries)}`);
      if (countries.data.length === 0) return res.status(404).json({ error: 'No countries found' });

      return res.json({
        data: countries.data,
      });
    } catch (err: any) {
      logger.logERROR(err?.response?.data || err);
      res.status(500).json({ error: 'Failed to get countries' });
    }
  });

  // Get cities
  router.get('/cities/:countryId', async (req, res) => {
    try {
      const { countryId } = req.params;
      const { deviceToken } = req.query;

      if (!deviceToken) return res.status(400).json({ error: 'Missing deviceToken' });

      const cities = await dVPNService.getCities(deviceToken as string, countryId);
      logger.logINFO(`cities: ${JSON.stringify(cities)}`);

      if (cities.data.length === 0)
        return res.status(404).json({ error: 'No cities found' });

      return res.json({ data: cities.data });
    } catch (err: any) {
      logger.logERROR(err?.response?.data || err);
      res.status(500).json({ error: 'Failed to get cities' });
    }
  });

  // Get servers
  router.get('/servers/:cityId', async (req, res) => {
    try {
      const { cityId } = req.params;
      const { deviceToken } = req.query;

      if (!deviceToken) return res.status(400).json({ error: 'Missing deviceToken' });

      const servers = await dVPNService.getServers(deviceToken as string, cityId);
      logger.logINFO(`servers: ${JSON.stringify(servers)}`);
      if (servers.data.length === 0) return res.status(404).json({ error: 'No servers found' });

      return res.json({ data: servers.data });
    } catch (err: any) {
      logger.logERROR(err?.response?.data || err);
      res.status(500).json({ error: 'Failed to get cities' });
    }
  });

  // Create server credentials
  router.post('/create-credentials/:serverId', async (req, res) => {
    try {
      const { serverId } = req.params;
      const { deviceToken } = req.query;

      if (!deviceToken) return res.status(400).json({ error: 'Missing deviceToken' });

      const credentials = await dVPNService.createServerCredentials(deviceToken as string, serverId);
      logger.logINFO(`credentials: ${JSON.stringify(credentials)}`);

      const configText = dVPNService.buildWireGuardConf(credentials.data);
      logger.logINFO(`configText: ${JSON.stringify(configText)}`);

      return res.json({
        credentials: credentials,
        config: configText,
      });
    } catch (err: any) {
      logger.logERROR(err?.response?.data || err);
      res.status(500).json({ error: 'Failed to get cities' });
    }
  });

  // Get all config to active VPN
  router.post('/active', async (req, res) => {
    try {
      const deviceInfo = await dVPNService.createDevice();

      const deviceToken = deviceInfo.data.token;
      const countries = await dVPNService.getCountries(deviceToken);
      if (countries.data.length === 0) return res.status(404).json({ error: 'No countries found' });

      const randomCountry = countries.data[Math.floor(Math.random() * countries.data.length)];
      const cities = await dVPNService.getCities(deviceToken, randomCountry.id);
      if (cities.data.length === 0) return res.status(404).json({ error: 'No cities found' });

      const randomCity = cities.data[Math.floor(Math.random() * cities.data.length)];
      const servers = await dVPNService.getServers(deviceToken, randomCity.id);
      if (servers.data.length === 0) return res.status(404).json({ error: 'No servers found' });

      const randomServer = servers.data[Math.floor(Math.random() * servers.data.length)];
      const credentials = await dVPNService.createServerCredentials(deviceToken, randomServer.id);

      const configWireGuard = dVPNService.buildWireGuardConf(credentials.data);
      logger.logINFO(`configWireGuard: ${JSON.stringify(configWireGuard)}`);
      return res.json({
        deviceToken: deviceToken,
        raw: credentials,
        configWireGuard: configWireGuard,
      });
    } catch (err: any) {
      logger.logERROR(err?.response?.data || err);
      res.status(500).json({ error: 'Failed to get VPN configuration' });
    }
  });

  return router;
}
