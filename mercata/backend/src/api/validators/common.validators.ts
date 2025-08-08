import Joi from "@hapi/joi";
import { StatusCodes } from "http-status-codes";

export function validateUserAddress(address: any): void {
  const schema = Joi.string()
    .required()
    .pattern(/^[a-fA-F0-9]{40}$/)
    .messages({
      "any.required": "User Address is required.",
      "string.pattern.base": "Invalid user address format.User address must be a valid Ethereum address.",
    });

  const { error } = schema.validate(address);
  if (error) {
    const err = new Error("Address Validation Error: " + error.message);
    (err as any).statusCode = StatusCodes.BAD_REQUEST; // or just 400
    throw err;
  }
}

export const validateAddressField = (label: string) =>
  Joi.string()
    .trim()
    .custom((value, helpers) => {
      // Normalize only for validation (don't modify returned value)
      const normalized = value.startsWith("0x") ? value : `0x${value}`;

      // Check basic Ethereum address format
      if (!/^0x[a-fA-F0-9]{40}$/.test(normalized)) {
        return helpers.error("ethereum.invalid");
      }

      // Passes validation → return the original unmodified value
      return value;
    }, "Ethereum Address Format")
    .required()
    .messages({
      "string.base": `"${label}" must be a string`,
      "string.empty": `"${label}" is required`,
      "ethereum.invalid": `"${label}" must be a valid Ethereum address with or without the "0x" prefix (40 hexadecimal characters)`,
      "any.required": `"${label}" is required`,
    });

export const numericStringField = (label: string, { allowZero = false } = {}) =>
  Joi.string()
    .trim()
    .pattern(/^\d+$/)
    .required()
    .custom((value, helpers) => {
      try {
        const big = BigInt(value);
        if (!allowZero && big <= 0n) return helpers.error("number.positive");
        return value; // Keep the original string
      } catch {
        return helpers.error("string.pattern.base");
      }
    }, "Positive numeric string check")
    .messages({
      "string.empty": `"${label}" is required`,
      "string.base": `"${label}" must be a string`,
      "string.pattern.base": `"${label}" must be a numeric string (integers only)`,
      "number.positive": `"${label}" must be greater than 0`,
      "any.required": `"${label}" is required`,
    });