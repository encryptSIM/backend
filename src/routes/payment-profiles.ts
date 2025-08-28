import { Request, Response, Router } from 'express';
import { Services } from '../index';
import { PaymentProfile } from '../types';
import { removeUndefined } from '../utils/helpers';

export default function paymentProfileRoutes(services: Services): Router {
  const router = Router();
  const { solanaService, database, logger } = services;

  router.post('/create-payment-profile', async (req: Request, res: Response) => {
    try {
      const { publicKey, privateKey } = await solanaService.createNewSolanaWallet();
      const paymentProfile: PaymentProfile = { publicKey, privateKey }

      await database.ref(`/payment_profiles/${publicKey}`).set(removeUndefined(paymentProfile));

      return res.status(200).json({ publicKey });
    } catch (error: any) {
      logger.logERROR(`Error creating payment profile: ${error}`);
      return res.status(500).json({ error: "Failed to create payment profile" });
    }
  });

  return router;
}
