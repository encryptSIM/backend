import { Router } from 'express';
import { err, ok, Result } from "neverthrow";
import z from "zod";
import { Services } from '../index';
import { removeUndefined } from '../utils/helpers';

export default function cacheRoutes(services: Services): Router {
  const router = Router();
  const { database } = services;

  router.get("/cache/:key", async (req, res) => {
    const keyResult = z.string().min(1).safeParse(req.params.key);

    if (!keyResult.success) {
      const errorDetails = z.treeifyError(keyResult.error);
      console.error("Invalid cache key in GET request:", errorDetails);
      return res.status(400).json({
        success: false,
        message: "Bad request",
        error: errorDetails,
      });
    }

    const key = keyResult.data;

    try {
      const getResult: Result<any, Error> = await new Promise((resolve) => {
        database.ref(`/cache/${key}`)
          .once('value')
          .then((snapshot: any) => {
            const data = snapshot.val();
            resolve(ok(data));
          })
          .catch((error: any) => resolve(err(error)));
      });

      if (getResult.isErr()) {
        console.error("Failed to get data in GET request:", getResult.error);
        return res.status(500).json({
          success: false,
          message: "Internal server error",
          error: getResult.error.message,
        });
      }

      const data = getResult.value;

      if (data === null) {
        return res.status(404).json({
          success: false,
          message: "Cache key not found",
        });
      }

      console.log("Data successfully retrieved in GET request:", { key });
      return res.status(200).json({
        success: true,
        data: data,
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

  router.post("/cache/:key", async (req, res) => {
    const keyResult = z.string().min(1).safeParse(req.params.key);

    if (!keyResult.success) {
      const errorDetails = z.treeifyError(keyResult.error);
      console.error("Invalid cache key in POST request:", errorDetails);
      return res.status(400).json({
        success: false,
        message: "Bad request",
        error: errorDetails,
      });
    }

    const bodySchema = z.object({
      value: z.any(),
      ttl: z.number().optional(),
    });

    const bodyResult = bodySchema.safeParse(req.body);

    if (!bodyResult.success) {
      const errorDetails = z.treeifyError(bodyResult.error);
      console.error("Invalid request body in POST request:", errorDetails);
      return res.status(400).json({
        success: false,
        message: "Bad request",
        error: errorDetails,
      });
    }

    const key = keyResult.data;
    const { value, ttl } = bodyResult.data;

    try {
      const cacheData = {
        value,
        timestamp: Date.now(),
        ...(ttl && { ttl }),
      };

      const setResult: Result<void, Error> = await new Promise((resolve) => {
        database.ref(`/cache/${key}`)
          .set(removeUndefined(cacheData))
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

      console.log("Data successfully cached in POST request:", { key, ttl });
      return res.status(200).json({
        success: true,
        message: "Data successfully cached",
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

  router.delete("/cache", async (req, res) => {

    try {
      const deleteResult: Result<void, Error> = await new Promise((resolve) => {
        database
          .ref(`/cache`)
          .remove()
          .then(() => resolve(ok(undefined)))
          .catch((error) => resolve(err(error)));
      });

      if (deleteResult.isErr()) {
        console.error(
          "Failed to delete data in DELETE request:",
          deleteResult.error
        );
        return res.status(500).json({
          success: false,
          message: "Internal server error",
          error: deleteResult.error.message,
        });
      }

      console.log("Data successfully deleted in cache");
      return res.status(200).json({
        success: true,
        message: "Cache key successfully deleted",
      });
    } catch (error: any) {
      console.error("Unexpected error in DELETE request:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  });


  router.delete("/cache/:key", async (req, res) => {
    const keyResult = z.string().min(1).safeParse(req.params.key);

    if (!keyResult.success) {
      const errorDetails = z.treeifyError(keyResult.error);
      console.error("Invalid cache key in DELETE request:", errorDetails);
      return res.status(400).json({
        success: false,
        message: "Bad request",
        error: errorDetails,
      });
    }

    const rawKey = keyResult.data;
    const safeKey = encodeURIComponent(rawKey);

    try {
      const deleteResult: Result<void, Error> = await new Promise((resolve) => {
        database
          .ref(`/cache/${safeKey}`)
          .remove()
          .then(() => resolve(ok(undefined)))
          .catch((error: any) => resolve(err(error)));
      });

      if (deleteResult.isErr()) {
        console.error(
          "Failed to delete data in DELETE request:",
          deleteResult.error
        );
        return res.status(500).json({
          success: false,
          message: "Internal server error",
          error: deleteResult.error.message,
        });
      }

      console.log("Data successfully deleted in DELETE request:", { rawKey });
      return res.status(200).json({
        success: true,
        message: "Cache key successfully deleted",
      });
    } catch (error: any) {
      console.error("Unexpected error in DELETE request:", error);
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  });

  return router;
}
