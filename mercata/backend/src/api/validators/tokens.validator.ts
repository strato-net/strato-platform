import Joi from "@hapi/joi";

// Schema definitions
const addressSchema = Joi.object({
  address: Joi.string().required(),
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
  address: Joi.string().required(),
  to: Joi.string().required(),
  value: Joi.string().pattern(/^\d+$/).required(),
});


const approveArgsSchema = Joi.object({
  address: Joi.string().required(),
  spender: Joi.string().required(),
  value: Joi.string().pattern(/^\d+$/).required(),
});

const transferFromArgsSchema = Joi.object({
  address: Joi.string().required(),
  from: Joi.string().required(),
  to: Joi.string().required(),
  value: Joi.string().pattern(/^\d+$/).required(),
});

const setStatusArgsSchema = Joi.object({
  address: Joi.string().required(),
  status: Joi.number().integer().min(1).max(3).required().messages({
    'number.min': 'Status must be 1 (PENDING), 2 (ACTIVE), or 3 (LEGACY)',
    'number.max': 'Status must be 1 (PENDING), 2 (ACTIVE), or 3 (LEGACY)',
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
    throw new Error("Transfer Item Argument Validation Error");
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