import Joi from "@hapi/joi";
import { validateAddressField, numericStringField, validateHashField } from "./common.validators";

export function validateRequestWithdrawal(args: any) {
  if (!args || typeof args !== "object") {
    throw new Error("Invalid input: args must be an object.");
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
    throw new Error("RequestWithdrawal Argument Validation Error: " + baseError.message);
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
    stratoTokenAmount: numericStringField("stratoTokenAmount"),
    externalRecipient: validateAddressField("externalRecipient"),
  }).strict();

  const { error } = finalSchema.validate(args);
  if (error) {
    throw new Error("RequestWithdrawal Argument Validation Error: " + error.message);
  }
}

export function validateDepositAction(args: any) {
  if (!args || typeof args !== "object") {
    throw new Error("Invalid input: args must be an object.");
  }

  const { externalChainId, externalTxHash, action } = args;
  
  if (!externalChainId || !externalTxHash || action === undefined || action === null) {
    throw new Error("RequestDepositAction Argument Validation Error: externalChainId, externalTxHash, and action are required");
  }

  const schema = Joi.object({
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
    externalTxHash: validateHashField("externalTxHash"),
    action: Joi.number()
      .integer()
      .valid(1, 2, 3)
      .required()
      .messages({
        "number.base": "action must be a number.",
        "any.only": "action must be 1, 2, or 3.",
        "any.required": "action is required.",
      }),
    targetToken: Joi.string()
      .optional()
      .allow("")
      .pattern(/^(0x)?[a-fA-F0-9]{40}$/)
      .messages({
        "string.pattern.base": "targetToken must be a valid 40-character hex address.",
      }),
    signature: Joi.string()
      .optional()
      .pattern(/^0x[a-fA-F0-9]{130}$/)
      .messages({
        "string.pattern.base": "signature must be a valid 65-byte hex signature.",
      }),
    deadline: Joi.string()
      .optional()
      .pattern(/^[0-9]+$/)
      .messages({
        "string.pattern.base": "deadline must be a Unix timestamp.",
      }),
  }).and("signature", "deadline");

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("RequestDepositAction Argument Validation Error: " + error.message);
  }
}

export function validateTransactionType(type: string): 'withdrawal' | 'deposit' {
  if (!type || typeof type !== 'string') {
    throw new Error("Transaction type is required and must be a string");
  }

  if (!['withdrawal', 'deposit'].includes(type)) {
    throw new Error("Invalid transaction type. Must be 'withdrawal' or 'deposit'");
  }

  return type as 'withdrawal' | 'deposit';
}