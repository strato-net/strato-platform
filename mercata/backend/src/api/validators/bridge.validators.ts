import Joi from "@hapi/joi";
import { validateAddressField, numericStringField } from "./common.validators";

export function validateBridgeOut(args: any) {
  if (!args || typeof args !== "object") {
    throw new Error("Invalid input: args must be an object.");
  }

  // Step 1: Basic presence and types
  const baseSchema = Joi.object({
    destChainId: Joi.string().required(),
    token: Joi.string().required(),
    amount: Joi.string().required(),
    destAddress: Joi.string().required(),
  }).strict();

  const { error: baseError } = baseSchema.validate(args);
  if (baseError) {
    throw new Error("BridgeOut Argument Validation Error: " + baseError.message);
  }

  // Step 2: Format and logic checks
  const finalSchema = Joi.object({
    destChainId: Joi.string()
      .required()
      .custom((value, helpers) => {
        const chainId = parseInt(value);
        if (isNaN(chainId) || chainId <= 0) {
          return helpers.error("any.invalid");
        }
        return value;
      }, "Chain ID validation")
      .messages({
        "any.invalid": "destChainId must be a positive integer.",
        "any.required": "destChainId is required.",
      }),
    token: validateAddressField("token"),
    amount: numericStringField("amount"),
    destAddress: validateAddressField("destAddress"),
  }).strict();

  const { error } = finalSchema.validate(args);
  if (error) {
    throw new Error("BridgeOut Argument Validation Error: " + error.message);
  }
}