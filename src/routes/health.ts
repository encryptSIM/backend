import { Router } from 'express';
import { Services } from '../index';

export default function healthRoutes(services?: Services): Router {
  const router = Router();

  router.get('/health', (req, res) => {
    return res.send("OK");
  });

  router.post('/error', async (req, res) => {
    try {
      if (!services) {
        return res.status(200).send("OK");
      }

      const { database, logger } = services;
      const { message } = req.body;
      const errorLog = {
        message: message
      };

      const timestamp = new Date().toISOString();
      const timestampKey = timestamp.replace(/[^a-zA-Z0-9]/g, '_');
      await database.ref(`/error_logs/${timestampKey}`).set(errorLog);

      logger.logINFO(`error logged: ${message}`)

      return res.status(200).send("OK")
    } catch (error: any) {
      console.error(`Error processing error log request: ${error}`);
      return res.status(500).json({ success: false, message: "Failed to process log request" });
    }
  });

  return router;
}
