import { Router } from 'express';
import { Services } from '../index';

export default function topupRoutes(services: Services): Router {
  const router = Router();
  const { topupHandler } = services;

  router.post('/topup', topupHandler.createTopupOrder);
  router.get('/topup/:orderId', topupHandler.queryTopUpOrder);
  router.get('/payment-profile/topup/:ppPublicKey', topupHandler.queryPPTopupOrder);

  return router;
}
