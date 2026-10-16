import Joi from "@hapi/joi";
import { StratoError } from "../../errors";
import { validateAddressField, uintStringField } from "./common.validators";

export function validateRequestWithdrawal(args: any) {
  if (!args || typeof args !== "object") {
    throw new StratoError("Invalid input: args must be an object.");
  }

  const isNative = args.routeType === "native";

  // Step 1: Basic presence and types
  const baseSchema = Joi.object({
    routeType: Joi.string().valid("standard", "native").optional(),
    externalChainId: Joi.string().required(),
    externalToken: isNative ? Joi.forbidden() : Joi.string().required(),
    stratoToken: Joi.string().required(),
    stratoTokenAmount: Joi.string().required(),
    externalRecipient: Joi.string().required(),
  }).strict();

  const { error: baseError } = baseSchema.validate(args);
  if (baseError) {
    throw new StratoError("RequestWithdrawal Argument Validation Error: " + baseError.message);
  }

  // Step 2: Format and logic checks
  const finalSchema = Joi.object({
    routeType: Joi.string()
      .valid("standard", "native")
      .optional()
      .messages({
        "any.only": "routeType must be either 'standard' or 'native'.",
      }),
    externalChainId: Joi.string()
      .required()
      .custom((value, helpers) => {
        if (!/^[0-9]+$/.test(value) || BigInt(value) <= 0n) {
          return helpers.error("any.invalid");
        }
        return value;
      }, "Chain ID validation")
      .messages({
        "any.invalid": "externalChainId must be a positive integer.",
        "any.required": "externalChainId is required.",
      }),
    externalToken: isNative
      ? Joi.forbidden().messages({
          "any.unknown": "externalToken is not used for native withdrawals.",
        })
      : validateAddressField("externalToken"),
    stratoToken: validateAddressField("stratoToken"),
    // Withdrawal amounts are raw integer base units; BigInt() downstream rejects decimals.
    stratoTokenAmount: uintStringField("stratoTokenAmount"),
    externalRecipient: validateAddressField("externalRecipient"),
  }).strict();

  const { error } = finalSchema.validate(args);
  if (error) {
    throw new StratoError("RequestWithdrawal Argument Validation Error: " + error.message);
  }
}

export function validateTransactionType(type: string): 'withdrawal' | 'deposit' {
  if (!type || typeof type !== 'string') {
    throw new StratoError("Transaction type is required and must be a string");
  }

  if (!['withdrawal', 'deposit'].includes(type)) {
    throw new StratoError("Invalid transaction type. Must be 'withdrawal' or 'deposit'");
  }

  return type as 'withdrawal' | 'deposit';
}