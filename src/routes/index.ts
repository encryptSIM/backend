import { Router } from 'express';
import { Services } from '../index';
import airaloRoutes from './airalo';
import cacheRoutes from './cache';
import couponRoutes from './coupons';
import healthRoutes from './health';
import orderRoutes from './orders';
import paymentProfileRoutes from './payment-profiles';
import simRoutes from './sims';
import topupRoutes from './topup';
import vpnRoutes from './vpn';

export default function createRoutes(services: Services): Router {
  const router = Router();

  router.use('/', airaloRoutes(services));
  router.use('/', cacheRoutes(services));
  router.use('/', couponRoutes(services));
  router.use('/', orderRoutes(services));
  router.use('/', simRoutes(services));
  router.use('/vpn', vpnRoutes(services));
  router.use('/', paymentProfileRoutes(services));
  router.use('/', topupRoutes(services));
  router.use('/', healthRoutes());

  return router;
}
