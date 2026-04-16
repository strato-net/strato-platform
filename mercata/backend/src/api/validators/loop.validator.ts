import Joi from "@hapi/joi";
import { validateAddressField, numericStringField } from "./common.validators";

export function validateExecuteArgs(args: any) {
  const schema = Joi.object({
    routeType: Joi.string().valid("cdp_loop").required(),
    asset: validateAddressField("asset"),
    amount: numericStringField("amount"),
    targetLeverage: Joi.number().min(1.1).max(10).required(),
    maxSlippageBps: Joi.number().integer().min(0).max(1000).optional(),
    minHealthFactor: Joi.number().min(1.15).optional(),
    clientQuoteHash: Joi.string().optional(),
    idempotencyKey: Joi.string().max(128).optional(),
  });

  const { error } = schema.validate(args);
  if (error) {
    const err = new Error("Validation Error: " + error.message);
    (err as any).statusCode = 400;
    throw err;
  }
}
