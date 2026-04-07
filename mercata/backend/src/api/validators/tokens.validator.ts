import Joi from "@hapi/joi";
import { validateAddressField, numericStringField } from "./common.validators";

// Schema definitions
const addressSchema = Joi.object({
  address: validateAddressField("address"),
});

const createTokensSchema = Joi.object({
  name: Joi.string().required(),
  description: Joi.string().required(),
  images: Joi.array().items(Joi.string()).required(),
  files: Joi.array().items(Joi.string()).required(),
  fileNames: Joi.array().items(Joi.string()).required(),
  symbol: Joi.string().required(),
  initialSupply: numericStringField("initialSupply", { allowZero: true }),
  customDecimals: Joi.number().integer().min(0).max(18).required(),
});

const transferItemSchema = Joi.object({
  address: validateAddressField("address"),
  to: validateAddressField("to"),
  value: numericStringField("value"),
});

const bulkTransferItemSchema = Joi.object({
  to: validateAddressField("to"),
  value: numericStringField("value"),
});

const bulkTransferSchema = Joi.object({
  address: validateAddressField("address"),
  transfers: Joi.array()
    .items(bulkTransferItemSchema)
    .min(1)
    .max(50)
    .required()
    .messages({
      "array.min": `"transfers" must contain at least 1 transfer`,
      "array.max": `"transfers" cannot exceed 50 transfers per batch`,
      "any.required": `"transfers" is required`,
    }),
});


const approveArgsSchema = Joi.object({
  address: validateAddressField("address"),
  spender: validateAddressField("spender"),
  value: numericStringField("value"),
});

const transferFromArgsSchema = Joi.object({
  address: validateAddressField("address"),
  from: validateAddressField("from"),
  to: validateAddressField("to"),
  value: numericStringField("value"),
});


const setStatusArgsSchema = Joi.object({
  address: validateAddressField("address"),
  status: Joi.number()
    .integer()
    .valid(1, 2, 3)
    .required()
    .messages({
      "any.only": `"status" must be one of 1 (PENDING), 2 (ACTIVE), or 3 (LEGACY)`,
      "number.base": `"status" must be a number`,
      "number.integer": `"status" must be an integer`,
      "any.required": `"status" is required`,
    }),
});

const queryParamsSchema = Joi.object().pattern(Joi.string(), Joi.string());

// Validator functions
export function validateAddressArgs(args: any) {
  const { error } = addressSchema.validate(args);
  if (error) {
    throw new Error("Address Argument Validation Error: " + error.message);
  }
}

export function validateCreateTokensArgs(args: any) {
  const { error } = createTokensSchema.validate(args);
  if (error) {
    throw new Error(
      "Create Inventory Argument Validation Error: " + error.message
    );
  }
}

export function validateTransferItemArgs(args: any) {
  const { error } = transferItemSchema.validate(args);
  if (error) {
    throw new Error("Transfer Item Argument Validation Error: " + error.message);
  }
}

export function validateQueryParams(query: any) {
  const { error } = queryParamsSchema.validate(query);
  if (error) {
    throw new Error("Query Parameter Validation Error: " + error.message);
  }
}

export function validateApproveArgs(args: any) {
  const { error } = approveArgsSchema.validate(args);
  if (error) {
    throw new Error("Approve Argument Validation Error: " + error.message);
  }
}
export function validateTransferFromArgs(args: any) {
  const { error } = transferFromArgsSchema.validate(args);
  if (error) {
    throw new Error("TransferFrom Argument Validation Error: " + error.message);
  }
}

export function validateSetStatusArgs(args: any) {
  const { error } = setStatusArgsSchema.validate(args);
  if (error) {
    throw new Error("SetStatus Argument Validation Error: " + error.message);
  }
}

export function validateBulkTransferArgs(args: any) {
  const { error } = bulkTransferSchema.validate(args);
  if (error) {
    throw new Error("Bulk Transfer Argument Validation Error: " + error.message);
  }
}