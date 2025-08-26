import { Router } from 'express';
import { ResultAsync } from "neverthrow";
import z from "zod";
import { Services } from '../index';
import { OrderDetailsSchema, SimOrder, generateFakeSimsFromOrders } from '../services/airaloService';
import { removeUndefined } from '../utils/helpers';

export default function orderRoutes(services: Services): Router {
  const router = Router();
  const { database, orderHandler, airaloWrapper, logger } = services;

  router.post('/order', orderHandler.createOrder);
  router.post('/add-order', orderHandler.addOrder);
  router.get('/order/:orderId', orderHandler.queryOrder);
  router.get('/payment-profile/sim/:ppPublicKey', orderHandler.queryPPOrder);

  router.post("/complete-order", async (req, res) => {
    const CompleteOrderBodySchema = z.object({
      orders: OrderDetailsSchema.array(),
      id: z.string(),
    });

    const parseResult = CompleteOrderBodySchema.safeParse(req?.body);

    if (parseResult.error) {
      console.error(JSON.stringify(parseResult.error, null, 2));
      return res.status(400).json({
        success: false,
        message: "Bad request",
        error: z.treeifyError(parseResult.error),
      });
    }

    const { orders, id } = parseResult.data;

    let sims: SimOrder[];

    if (process.env.MOCK_COMPLETE_ORDER_ENABLED === "true") {
      sims = generateFakeSimsFromOrders(orders);
    } else {
      const placeOrderResults = await Promise.all(
        orders.map((order) =>
          ResultAsync.fromPromise(
            airaloWrapper.placeOrder(order)
              .then((sim) => ({
                ...sim,
                region: order.region,
                country_code: order.country_code,
                package_id: order.package_id,
                package_title: order.package_title,
                expiration_ms: order.expiration_ms,
                created_at_ms: order.created_at_ms,
              })),
            (error) => error
          )
        )
      );

      const failedOrders = placeOrderResults.filter((result) => result.isErr());
      if (failedOrders.length > 0) {
        console.error(
          JSON.stringify(
            {
              message: "Failed to place some orders",
              data: {
                failedOrders: failedOrders.map((result) => result.error),
              },
            },
            null,
            2
          )
        );
        return res.status(500).json({
          success: false,
          message: "Failed to place some orders",
          errors: failedOrders.map((result) => result.error),
        });
      }

      sims = placeOrderResults
        .map((result) => {
          if (result.isOk()) return result.value;
          return null;
        })
        .filter((t) => !!t);
    }

    const simsObject = sims.reduce((acc: any, sim: any) => {
      acc[sim.iccid] = removeUndefined(sim);
      return acc;
    }, {});

    const updateResult = await ResultAsync.fromPromise(
      database.ref(`sims/${id}`).update(simsObject),
      (error) => error
    );

    if (updateResult.isErr()) {
      console.error(
        JSON.stringify(
          {
            message: "Failed to update SIMs in the database",
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
        message: "Failed to update SIMs in the database",
        error: updateResult.error,
      });
    }

    console.info(
      JSON.stringify(
        {
          message: "Order completed successfully",
          data: { id, sims },
        },
        null,
        2
      )
    );
    return res.status(200).json({ success: true, message: "Order completed", sims });
  });

  return router;
}
