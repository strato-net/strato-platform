import Joi from "@hapi/joi";
import { ethereumAddressField, numericStringField } from "./common.validators";

export function validateBridgeIn(args: any) {
  if (!args || typeof args !== "object") {
    throw new Error("Invalid input: args must be an object.");
  }

  // Step 1: Check required fields presence and basic type
  const baseSchema = Joi.object({
    fromAddress: Joi.string().required(),
    amount: Joi.string().required(),
    tokenAddress: Joi.string().required(),
    ethHash: Joi.string().required(),
  }).strict();

  const { error: baseError } = baseSchema.validate(args);
  if (baseError) {
    throw new Error("Bridge Argument Validation Error: " + baseError.message);
  }

  // Step 2: Full format and logical validation
  const finalSchema = Joi.object({
    fromAddress: ethereumAddressField("fromAddress"),
    amount: numericStringField("amount"),
    tokenAddress: ethereumAddressField("tokenAddress"),
    ethHash: Joi.string()
      .required()
      .custom((value, helpers) => {
        if (value.length !== 66) {
          return helpers.error("string.length");
        }

        if (!/^0x[a-fA-F0-9]{64}$/.test(value)) {
          return helpers.error("string.pattern.base");
        }

        return value;
      }, "Ethereum hash format and length validation")
      .messages({
        "string.length": "ethHash must be exactly 66 characters long (0x + 64 hex digits).",
        "string.pattern.base": "ethHash must be a valid Ethereum transaction hash (starting with 0x and followed by 64 hex characters).",
        "any.required": "ethHash is required.",
      }),
  }).strict();

  const { error } = finalSchema.validate(args);
  if (error) {
    throw new Error("Bridge Argument Validation Error: " + error.message);
  }
}

export function validateBridgeOut(args: any) {
  if (!args || typeof args !== "object") {
    throw new Error("Invalid input: args must be an object.");
  }

  // Step 1: Basic presence and types
  const baseSchema = Joi.object({
    toAddress: Joi.string().required(),
    amount: Joi.string().required(),
    tokenAddress: Joi.string().required(),
  }).strict();

  const { error: baseError } = baseSchema.validate(args);
  if (baseError) {
    throw new Error("BridgeOut Argument Validation Error: " + baseError.message);
  }

  // Step 2: Format and logic checks
  const finalSchema = Joi.object({
    toAddress: ethereumAddressField("toAddress"),
    amount: numericStringField("amount"),
    tokenAddress: ethereumAddressField("tokenAddress"),
  }).strict();

  const { error } = finalSchema.validate(args);
  if (error) {
    throw new Error("BridgeOut Argument Validation Error: " + error.message);
  }
}