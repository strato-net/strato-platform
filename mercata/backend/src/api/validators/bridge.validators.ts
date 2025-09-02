import Joi from "@hapi/joi";
import { validateAddressField, numericStringField } from "./common.validators";

export function validateRequestWithdrawal(args: any) {
  if (!args || typeof args !== "object") {
    throw new Error("Invalid input: args must be an object.");
  }

  // Step 1: Basic presence and types
  const baseSchema = Joi.object({
    externalChainId: Joi.string().required(),
    stratoToken: Joi.string().required(),
    stratoTokenAmount: Joi.string().required(),
    externalRecipient: Joi.string().required(),
    targetStratoToken: Joi.string().optional(),
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
    stratoToken: validateAddressField("stratoToken"),
    stratoTokenAmount: numericStringField("stratoTokenAmount"),
    externalRecipient: validateAddressField("externalRecipient"),
    targetStratoToken: validateAddressField("targetStratoToken").optional(),
  }).strict();

  const { error } = finalSchema.validate(args);
  if (error) {
    throw new Error("RequestWithdrawal Argument Validation Error: " + error.message);
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