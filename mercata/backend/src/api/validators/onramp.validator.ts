import Joi from "@hapi/joi";
import { validateAddressField, numericStringField } from "./common.validators";
export function validateBuyArgs(args: any) {
  
  if (!args || typeof args !== "object") {
    throw new Error("Invalid input: args must be an object.");
  }

  // First validate required fields are present
  const baseSchema = Joi.object({
    token: Joi.string().required(),
    amount: Joi.string().required(),
    paymentProviderAddress: Joi.string().required(),
  }).strict();

  const { error: baseError } = baseSchema.validate(args);
  if (baseError) {
    throw new Error("Buy Argument Validation Error: " + baseError.message);
  }

  // Post-normalization validation
  const finalSchema = Joi.object({
    token: validateAddressField("token"),
    amount: numericStringField("amount"),
    paymentProviderAddress: validateAddressField("paymentProviderAddress"),
  }).strict();

  const { error } = finalSchema.validate(args);
  if (error) {
    throw new Error("Buy Argument Validation Error: " + error.message);
  }
}

export function validateSellArgs(args: any) {
  if (!args || typeof args !== "object") {
    throw new Error("Invalid input: args must be an object.");
  }

  // Step 1: Initial basic validation
  const baseSchema = Joi.object({
    token: Joi.string().required(),
    amount: Joi.string().required(),
    marginBps: Joi.string().required(),
    providerAddresses: Joi.array().items(Joi.string().required()).min(1).required(),
  }).strict();

  const { error: baseError } = baseSchema.validate(args);
  if (baseError) {
    throw new Error("Sell Argument Validation Error: " + baseError.message);
  }

  const finalSchema = Joi.object({
    token: validateAddressField("token"),
    amount:numericStringField("amount"),
    marginBps: Joi.string()
      .pattern(/^\d+$/)
      .required()
      .custom((value, helpers) => {
        const bps = BigInt(value);
        if (bps < 0n || bps > 10000n) {
          return helpers.error("any.invalid");
        }
        return value;
      }, "marginBps range check")
      .messages({
        "any.invalid": "Margin (bps) must be between 0 and 10000.",
      }),

    providerAddresses: Joi.array()
      .items(
        Joi.string()
          .pattern(/^[a-fA-F0-9]{40}$/)
          .messages({
            "string.pattern.base": "Each provider address must be a valid Ethereum address.",
          })
      )
      .required()
      .min(1)
      .messages({
        "array.base": "Provider addresses must be an array.",
        "array.min": "At least one provider address is required.",
      }),
  }).strict();

  const { error } = finalSchema.validate(args);
  if (error) {
    throw new Error("Sell Argument Validation Error: " + error.message);
  }
}

export function validateAddPaymentProviderArgs(args: any) {
  if (!args || typeof args !== "object") {
    throw new Error("Invalid input: args must be an object.");
  }

  const schema = Joi.object({
    providerAddress: Joi.string()
      .pattern(/^(0x)?[a-fA-F0-9]{40}$/i)
      .required()
      .messages({
        "string.pattern.base": "Provider address must be 40 hex characters (with or without 0x prefix).",
        "any.required": "Provider address is required.",
      }),
    name: Joi.string()
      .min(2)
      .max(100)
      .required()
      .messages({
        "string.min": "Provider name must be at least 2 characters.",
        "string.max": "Provider name must not exceed 100 characters.",
        "any.required": "Provider name is required.",
      }),
    endpoint: Joi.string()
      .pattern(/^https?:\/\/.+/)
      .required()
      .messages({
        "string.pattern.base": "Endpoint must be a valid HTTP or HTTPS URL.",
        "any.required": "Endpoint URL is required.",
      }),
  }).strict();

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Add Payment Provider Validation Error: " + error.message);
  }
}

export function validateRemovePaymentProviderArgs(args: any) {
  if (!args || typeof args !== "object") {
    throw new Error("Invalid input: args must be an object.");
  }

  const schema = Joi.object({
    providerAddress: Joi.string()
      .pattern(/^(0x)?[a-fA-F0-9]{40}$/i)
      .required()
      .messages({
        "string.pattern.base": "Provider address must be 40 hex characters (with or without 0x prefix).",
        "any.required": "Provider address is required.",
      }),
  }).strict();

  const { error } = schema.validate(args);
  if (error) {
    throw new Error("Remove Payment Provider Validation Error: " + error.message);
  }
}