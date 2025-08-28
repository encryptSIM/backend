import { Router } from 'express';
import { err, ok, Result, ResultAsync } from "neverthrow";
import z from "zod";
import { Services } from '../index';
import { AiraloSIMTopup } from '../services/airaloService';
import { removeUndefined } from '../utils/helpers';

export default function simRoutes(services: Services): Router {
  const router = Router();
  const { database, airaloWrapper, logger } = services;

  router.post("/sim-usage/:iccid/", async (req, res) => {
    const iccidResult = z.string().min(1).safeParse(req.params.iccid);

    if (!iccidResult.success) {
      const errorDetails = z.treeifyError(iccidResult.error);
      console.error("Invalid ICCID in POST request:", errorDetails);
      return res.status(400).json({
        success: false,
        message: "Bad request",
        error: errorDetails,
      });
    }

    const iccid = iccidResult.data;

    try {
      const setResult: Result<void, Error> = await new Promise((resolve) => {
        database.ref(`/sim-usage/${iccid}`)
          .set(removeUndefined(req.body.data))
          .then(() => resolve(ok(undefined)))
          .catch((error: any) => resolve(err(error)));
      });

      if (setResult.isErr()) {
        console.error("Failed to set data in POST request:", setResult.error);
        return res.status(500).json({
          success: false,
          message: "Internal server error",
          error: setResult.error.message,
        });
      }

      console.log("Data successfully set in POST request:", { iccid, data: req.body.data });
      return res.status(200).json({
        success: true,
        message: "Data successfully set",
      });
    } catch (error: any) {
      console.error("Unexpected error in POST request:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  });

  router.get("/sim-usage/:iccid/", async (req, res) => {
    const iccidResult = z.string().min(1).safeParse(req.params.iccid);

    if (!iccidResult.success) {
      const errorDetails = z.treeifyError(iccidResult.error);
      console.error("Invalid ICCID in GET request:", errorDetails);
      return res.status(400).json({
        success: false,
        message: "Bad request",
        error: errorDetails,
      });
    }

    const iccid = iccidResult.data;

    try {
      const getResult: Result<any, Error> = await new Promise((resolve) => {
        database.ref(`/sim-usage/${iccid}`)
          .get()
          .then((data: any) => resolve(ok(data)))
          .catch((error: any) => resolve(err(error)));
      });

      if (getResult.isErr()) {
        console.error("Failed to retrieve data in GET request:", getResult.error);
        return res.status(500).json({
          success: false,
          message: "Internal server error",
          error: getResult.error.message,
        });
      }

      const data = getResult.value;
      console.log("Data successfully retrieved in GET request:", { iccid, data });
      return res.status(200).json({
        success: true,
        data,
      });
    } catch (error: any) {
      console.error("Unexpected error in GET request:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  });

  router.post("/mark-sim-installed", async (req, res) => {
    const MarkSimInstalledBodySchema = z.object({
      installed: z.boolean(),
      iccid: z.string(),
      id: z.string()
    });

    const parseResult = MarkSimInstalledBodySchema.safeParse(req?.body);

    if (parseResult.error) {
      console.error(JSON.stringify(parseResult.error, null, 2));
      return res.status(400).json({
        success: false,
        message: "Bad request",
        error: z.treeifyError(parseResult.error),
      });
    }

    const { installed, iccid, id } = parseResult.data;

    const updateResult = await ResultAsync.fromPromise(
      database.ref(`sims/${id}/${iccid}`).update({ installed }),
      (error) => error
    );

    if (updateResult.isErr()) {
      console.error(
        JSON.stringify(
          {
            message: "Failed to update SIM's installation status in the database",
            data: {
              error: updateResult.error,
            },
          },
          null,
          2
        )
      );
      return res.status(500).json({
        success: false,
        message: "Failed to update SIM's installation status in the database",
        error: updateResult.error,
      });
    }

    console.info(
      JSON.stringify(
        {
          message: "SIM updated completed successfully",
          data: { iccid, installed },
        },
        null,
        2
      )
    );
    return res.status(200).json({ success: true, message: "Success" });
  });

  router.get("/fetch-sims/:id", async (req, res) => {
    const { id } = req.params;

    if (!id) {
      const errorMessage = {
        message: "Missing ID in request parameters",
      };
      console.error(JSON.stringify(errorMessage, null, 2));
      return res.status(400).json({
        success: false,
        message: errorMessage.message,
      });
    }

    const fetchResult = await ResultAsync.fromPromise(
      database.ref(`sims/${id}`).once("value"),
      (error) => error
    );

    if (fetchResult.isErr()) {
      console.error(
        JSON.stringify(
          {
            message: "Failed to fetch SIMs from the database",
            data: { id, error: fetchResult.error },
          },
          null,
          2
        )
      );
      return res.status(500).json({
        success: false,
        message: "Failed to fetch SIMs from the database",
        error: fetchResult.error,
      });
    }

    const simsSnapshot = fetchResult.value;

    if (!simsSnapshot.exists()) {
      const warningMessage = {
        message: "No SIMs found for the given ID",
        data: { id },
      };
      console.info(JSON.stringify(warningMessage, null, 2));
      return res.status(404).json({
        success: false,
        message: warningMessage.message,
      });
    }

    const sims = simsSnapshot.val();

    console.info(
      JSON.stringify(
        {
          message: "SIMs fetched successfully",
          data: { id, sims },
        },
        null,
        2
      )
    );
    return res.status(200).json({
      success: true,
      message: "SIMs fetched successfully",
      data: Object.values(sims),
    });
  });

  router.get('/sim/:iccid/topups', async (req, res) => {
    try {
      const { iccid } = req.params;

      if (!iccid) {
        return res.status(400).json({ error: 'Missing required parameter: iccid' });
      }
      const topups: AiraloSIMTopup[] = await airaloWrapper.getSIMTopups(iccid);

      if (!topups) {
        return res.status(500).json({ error: 'Failed to retrieve SIM top-ups' });
      }

      return res.json(topups);

    } catch (error: any) {
      logger.logERROR(`Error getting top-ups for ICCID ${req.params.iccid}: ${error}`);
      const errorMessage = error.message || "Failed to retrieve SIM top-ups";
      return res.status(500).json({ error: errorMessage });
    }
  });

  router.get('/sim/:iccid/usage', async (req, res) => {
    try {
      const { iccid } = req.params;

      if (!iccid) {
        return res.status(400).json({ error: 'Missing required parameter: iccid' });
      }
      const usage: any = await airaloWrapper.getDataUsage(iccid);

      return res.json(usage);

    } catch (error: any) {
      logger.logERROR(`Error getting usage for ICCID ${req.params.iccid}: ${error}`);
      const errorMessage = error.message || "Failed to retrieve SIM usage";
      return res.status(500).json({ error: errorMessage });
    }
  });

  return router;
}
