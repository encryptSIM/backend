import { Router } from 'express';
import axios from 'axios';
import qs from 'querystring';
import { Services } from '../index';
import { airaloFetchClient } from "../airalo-api/api";
import z from 'zod';

export default function airaloRoutes(services: Services): Router {
  const router = Router();
  const { logger } = services;

  router.get("/v2/packages", async (req, res) => {
    try {
      const filterSchema = z.object({
        type: z.string(),
        country: z.string().optional()
      })

      const { type, country } = filterSchema.parse(req.query.filter)

      const result = await airaloFetchClient.GET("/v2/packages", {
        headers: {
          Authorization: req.headers.authorization || "",
        },
        params: {
          query: {
            "filter[type]": type,
            "filter[country]": country,
          },
        },
      });

      console.log(
        "formatted query",
        JSON.stringify(
          {
            headers: {
              Authorization: req.headers.authorization || "",
            },
            params: {
              query: {
                "filter[type]": type,
                "filter[country]": country,
              },
            },
          },
          null,
          2
        )
      );

      res.status(result.response.status).json(result.data);
    } catch (err) {
      console.error("Proxy error:", err);
      res.status(500).json({ error: "Failed to fetch packages", err });
    }
  });

  router.get("/v2/sims/:sim_iccid/usage", async (req, res) => {
    try {
      const { sim_iccid } = req.params;

      const result = await airaloFetchClient.GET("/v2/sims/{sim_iccid}/usage", {
        headers: {
          Authorization: req.headers.authorization || "",
        },
        params: {
          path: {
            sim_iccid,
          },
        },
      });

      res.status(result.response.status).json(result.data);
    } catch (err) {
      console.error("Proxy error:", err);
      res.status(500).json({ error: "Failed to fetch SIM usage" });
    }
  });

  router.get("/airalo/token", async (req, res) => {
    const AIRALO_CLIENT_ID = process.env.AIRALO_CLIENT_ID;
    const AIRALO_CLIENT_SECRET = process.env.AIRALO_CLIENT_SECRET;

    if (!AIRALO_CLIENT_ID || !AIRALO_CLIENT_SECRET) {
      return res.status(500).json({
        error: "Airalo client ID or secret not configured in environment variables.",
      });
    }

    const requestBody = qs.stringify({
      client_id: AIRALO_CLIENT_ID,
      client_secret: AIRALO_CLIENT_SECRET,
      grant_type: "client_credentials",
    });

    const options = {
      method: "POST",
      url: `${process.env.AIRALO_CLIENT_URL}/v2/token`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      data: requestBody,
    };

    try {
      const { data } = await axios.request(options);
      console.log("Airalo Token Response:", data);
      return res.status(200).json(data);
    } catch (error: any) {
      console.error("Error fetching Airalo token:", error.response ? error.response.data : error.message);

      return res.status(error.response ? error.response.status : 500).json({
        error: "Failed to obtain Airalo token",
        details: error.response ? error.response.data : error.message,
      });
    }
  });

  router.get('/packages', async (req, res) => {
    try {
      const { type, country } = req.query;

      if (!type) {
        return res.status(400).json({ error: 'Missing required parameters: type' });
      }

      const packageType = type as 'global' | 'local' | 'regional';
      const packages = await services.airaloWrapper.getPackagePlans(packageType, country as string);

      if (packages === undefined) {
        return res.status(500).json({ error: 'Failed to retrieve package plans' });
      }

      return res.json(packages);
    } catch (error: any) {
      logger.logERROR(`Error in /packages endpoint: ${error}`);
      return res.status(500).json({ error: "Failed to retrieve package plans" });
    }
  });

  return router;
}
