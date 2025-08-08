import Joi from "@hapi/joi";
import { ethereumAddressField } from "./common.validators";

const valueField = Joi.string()
  .pattern(/^\d+$/)
  .required()
  .label("value")
  .messages({
    "string.empty": `"value" is required`,
    "string.pattern.base": `"value" must be a valid numeric string`,
  });

// Schema definitions
const addressSchema = Joi.object({
  address: ethereumAddressField("address"),
});

const createTokensSchema = Joi.object({
  name: Joi.string().required(),
  description: Joi.string().required(),
  images: Joi.array().items(Joi.string()).required(),
  files: Joi.array().items(Joi.string()).required(),
  fileNames: Joi.array().items(Joi.string()).required(),
  symbol: Joi.string().required(),
  initialSupply: Joi.string()
    .pattern(/^\d+$/)
    .required()
    .messages({
      'string.pattern.base': '"initialSupply" must be a string of digits',
    }),
  customDecimals: Joi.number().integer().min(0).max(18).required(),
});

const transferItemSchema = Joi.object({
  address: ethereumAddressField("address"),
  to: ethereumAddressField("to"),
  value: valueField,
});


const approveArgsSchema = Joi.object({
  address: ethereumAddressField("address"),
  spender: ethereumAddressField("spender"),
  value: valueField,
});

const transferFromArgsSchema = Joi.object({
  address: ethereumAddressField("address"),
  from: ethereumAddressField("from"),
  to: ethereumAddressField("to"),
  value: valueField,
});


const setStatusArgsSchema = Joi.object({
  address: ethereumAddressField("address"),
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
    throw new Error("Address Argument Validation Error");
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