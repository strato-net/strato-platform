import Joi from "@hapi/joi";
import { validateAddressField, numericStringField, validateHashField } from "./common.validators";

export function validateRequestWithdrawal(args: any) {
  if (!args || typeof args !== "object") {
    throw new Error("Invalid input: args must be an object.");
  }

  // Step 1: Basic presence and types
  const baseSchema = Joi.object({
    externalChainId: Joi.string().required(),
    externalToken: Joi.string().required(),
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
    externalChainId: Joi.string()
      .required()
      .custom((value, helpers) => {
        const chainId = parseInt(value);
        if (isNaN(chainId) || chainId <= 0) {
          return helpers.error("any.invalid");
        }
        return value;
      }, "Chain ID validation")
      .messages({
        "any.invalid": "externalChainId must be a positive integer.",
        "any.required": "externalChainId is required.",
      }),
    externalToken: validateAddressField("externalToken"),
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
        const chainId = parseInt(value);
        if (isNaN(chainId) || chainId <= 0) {
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
      .min(1)
      .required()
      .messages({
        "number.base": "action must be a number.",
        "number.min": "action must be at least 1.",
        "any.required": "action is required.",
      }),
    targetToken: Joi.string()
      .optional()
      .allow("")
      .pattern(/^(0x)?[a-fA-F0-9]{40}$/)
      .messages({
        "string.pattern.base": "targetToken must be a valid 40-character hex address.",
      }),
  });

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