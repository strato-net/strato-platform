import Joi from "@hapi/joi";
import { validateAddressField, numericStringField } from "./common.validators";
import { LOOP_CONSTANTS } from "../services/loop.types";

const loopRouteTypes = ["lending_loop", "cdp_loop"];

export function validateExecuteArgs(args: any) {
  const schema = Joi.object({
    routeType: Joi.string()
      .valid(...loopRouteTypes)
      .required()
      .messages({
        "any.only": `routeType must be one of: ${loopRouteTypes.join(", ")}`,
      }),
    asset: validateAddressField("asset"),
    amount: numericStringField("amount"),
    loops: Joi.number()
      .integer()
      .min(1)
      .max(LOOP_CONSTANTS.MAX_LOOPS)
      .required()
      .messages({
        "number.min": "loops must be at least 1",
        "number.max": `loops must not exceed ${LOOP_CONSTANTS.MAX_LOOPS}`,
      }),
    minHealthFactor: Joi.number()
      .min(LOOP_CONSTANTS.MIN_HEALTH_FACTOR)
      .optional()
      .messages({
        "number.min": `minHealthFactor must be at least ${LOOP_CONSTANTS.MIN_HEALTH_FACTOR}`,
      }),
    clientQuoteHash: Joi.string().optional(),
    idempotencyKey: Joi.string().max(128).optional(),
    dryRun: Joi.boolean().optional(),
  });

  const { error } = schema.validate(args);
  if (error) {
    const err = new Error("Loop Execute Validation Error: " + error.message);
    (err as any).statusCode = 400;
    throw err;
  }
}

export function validateUnwindArgs(args: any) {
  const schema = Joi.object({
    routeType: Joi.string()
      .valid(...loopRouteTypes)
      .required(),
    asset: validateAddressField("asset"),
    steps: Joi.alternatives()
      .try(
        Joi.number().integer().min(1).max(LOOP_CONSTANTS.MAX_LOOPS),
        Joi.string().valid("all")
      )
      .required()
      .messages({
        "alternatives.match": `steps must be 1-${LOOP_CONSTANTS.MAX_LOOPS} or "all"`,
      }),
    minHealthFactor: Joi.number()
      .min(LOOP_CONSTANTS.MIN_HEALTH_FACTOR)
      .optional(),
    idempotencyKey: Joi.string().max(128).optional(),
  });

  const { error } = schema.validate(args);
  if (error) {
    const err = new Error("Loop Unwind Validation Error: " + error.message);
    (err as any).statusCode = 400;
    throw err;
  }
}
