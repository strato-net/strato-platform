import Joi from "@hapi/joi";

const manageLiquiditySchema = Joi.object({
  asset: Joi.string().required(),
  amount: Joi.string().required(),
});

const getLoanArgsSchema = Joi.object({
  asset: Joi.string().required(),
  amount: Joi.string().required(),
  collateralAsset: Joi.string().required(),
  collateralAmount: Joi.string().required(),
});

const repayLoanArgsSchema = Joi.object({
  loanId: Joi.string().required(),
  asset: Joi.string().required(),
  amount: Joi.string().required(),
});

const loanIdParamSchema = Joi.object({
  id: Joi.string().pattern(/^\d+$/).required(),
});

const marginQuerySchema = Joi.object({
  margin: Joi.number().min(0).max(1).optional(),
});

// Validator functions
export function validateManageLiquidityArgs(args: any) {
  const { error } = manageLiquiditySchema.validate(args);
  if (error) {
    throw new Error(
      "Manage Liquidity Argument Validation Error: " + error.message
    );
  }
}

export function validateGetLoanArgs(args: any) {
  const { error } = getLoanArgsSchema.validate(args);
  if (error) {
    throw new Error("Get Loan Argument Validation Error: " + error.message);
  }
}

export function validateRepayLoanArgs(args: any) {
  const { error } = repayLoanArgsSchema.validate(args);
  if (error) {
    throw new Error("Repay Loan Argument Validation Error: " + error.message);
  }
}

export function validateLoanIdParam(params: any) {
  const { error } = loanIdParamSchema.validate(params);
  if (error) {
    throw new Error("LoanId Validation Error: " + error.message);
  }
}

export function validateMarginQuery(query: any) {
  const { error } = marginQuerySchema.validate(query);
  if (error) {
    throw new Error("Margin Query Validation Error: " + error.message);
  }
}
