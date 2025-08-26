import { Router } from 'express';
import z from "zod";
import { Services } from '../index';

export default function couponRoutes(services: Services): Router {
  const router = Router();
  const { firestore } = services;

  router.get("/coupon/:code", async (req, res) => {
    const codeResult = z.string().min(3).max(32).safeParse(req.params.code);

    if (!codeResult.success) {
      const errorDetails = z.treeifyError(codeResult.error);
      return res.status(400).json({
        success: false,
        message: "Bad request",
        error: errorDetails,
      });
    }

    const code = codeResult.data;

    try {
      const doc = await firestore.collection("coupons").doc(code).get();

      if (!doc.exists) {
        return res.status(404).json({
          success: false,
          message: "Coupon not found",
        });
      }

      return res.status(200).json({
        success: true,
        data: doc.data(),
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  });

  router.post("/coupon/:code/redeem", async (req, res) => {
    const codeResult = z.string().min(3).max(32).safeParse(req.params.code);

    if (!codeResult.success) {
      const errorDetails = z.treeifyError(codeResult.error);
      return res.status(400).json({
        success: false,
        message: "Bad request",
        error: errorDetails,
      });
    }

    const code = codeResult.data;

    try {
      const docRef = firestore.collection("coupons").doc(code);
      const doc = await docRef.get();

      if (!doc.exists) {
        return res.status(404).json({
          success: false,
          message: "Coupon not found",
        });
      }

      const coupon = doc.data();

      if (coupon.redeemed) {
        return res.status(400).json({
          success: false,
          message: "Coupon already redeemed",
        });
      }

      if (coupon.expiresAt && new Date(coupon.expiresAt) < new Date()) {
        return res.status(400).json({
          success: false,
          message: "Coupon expired",
        });
      }

      await docRef.update({ redeemed: true });

      return res.status(200).json({
        success: true,
        message: "Coupon redeemed successfully",
        data: { ...coupon, redeemed: true },
      });
    } catch (error: any) {
      return res.status(500).json({
        success: false,
        message: "Internal server error",
        error: error.message,
      });
    }
  });

  return router;
}
