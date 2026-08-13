import Joi from "@hapi/joi";
import { StatusCodes } from "http-status-codes";
import { validateAddressField, uintStringField } from "./common.validators";

// Validation failures must surface as 400s with their real message. A bare `new Error`
// has no status, so errorHandler falls through to 500 and sanitizes the message to a
// generic string — set statusCode explicitly (matching common.validators).
const throwValidation = (prefix: string, message: string): never => {
  const err = new Error(`${prefix}: ${message}`);
  (err as any).statusCode = StatusCodes.BAD_REQUEST;
  throw err;
};

// Schema definitions
const collectionAddressSchema = Joi.object({
  address: validateAddressField("address"),
});

const itemParamsSchema = Joi.object({
  address: validateAddressField("address"),
  tokenId: uintStringField("tokenId"),
});

const transferSchema = Joi.object({
  to: validateAddressField("to"),
  tokenId: uintStringField("tokenId"),
});

const burnSchema = Joi.object({
  tokenId: uintStringField("tokenId"),
});

const queryParamsSchema = Joi.object().pattern(Joi.string(), Joi.string().allow(""));

// Validator functions
export function validateCollectionAddressArgs(args: any) {
  const { error } = collectionAddressSchema.validate(args);
  if (error) throwValidation("NFT Collection Address Validation Error", error.message);
}

export function validateItemParams(args: any) {
  const { error } = itemParamsSchema.validate(args);
  if (error) throwValidation("NFT Item Params Validation Error", error.message);
}

export function validateTransferArgs(args: any) {
  const { error } = transferSchema.validate(args);
  if (error) throwValidation("NFT Transfer Validation Error", error.message);
}

export function validateBurnArgs(args: any) {
  const { error } = burnSchema.validate(args);
  if (error) throwValidation("NFT Burn Validation Error", error.message);
}

export function validateQueryParams(args: any) {
  const { error } = queryParamsSchema.validate(args);
  if (error) throwValidation("NFT Query Params Validation Error", error.message);
}
