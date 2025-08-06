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