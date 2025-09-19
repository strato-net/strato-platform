// ---------------- Error Types ----------------
export interface ApiError {
  message: string;
  code?: string;
  statusCode?: number;
  details?: Record<string, any>;
}

export interface ValidationError extends ApiError {
  code: 'VALIDATION_ERROR';
  field?: string;
  value?: any;
}

export interface PoolNotFoundError extends ApiError {
  code: 'POOL_NOT_FOUND';
  poolAddress: string;
}

export interface InsufficientLiquidityError extends ApiError {
  code: 'INSUFFICIENT_LIQUIDITY';
  poolAddress: string;
  requiredAmount: string;
  availableAmount: string;
}

export interface InvalidTokenError extends ApiError {
  code: 'INVALID_TOKEN';
  tokenAddress: string;
}

export interface SwapCalculationError extends ApiError {
  code: 'SWAP_CALCULATION_ERROR';
  amountIn: string;
  poolAddress: string;
}

export interface TransactionError extends ApiError {
  code: 'TRANSACTION_ERROR';
  transactionHash?: string;
  gasUsed?: string;
}

// ---------------- Error Factory Functions ----------------
export const createValidationError = (message: string, field?: string, value?: any): ValidationError => ({
  message,
  code: 'VALIDATION_ERROR',
  field,
  value,
  statusCode: 400
});

export const createPoolNotFoundError = (poolAddress: string): PoolNotFoundError => ({
  message: `Pool not found: ${poolAddress}`,
  code: 'POOL_NOT_FOUND',
  poolAddress,
  statusCode: 404
});

export const createInsufficientLiquidityError = (
  poolAddress: string, 
  requiredAmount: string, 
  availableAmount: string
): InsufficientLiquidityError => ({
  message: `Insufficient liquidity in pool ${poolAddress}. Required: ${requiredAmount}, Available: ${availableAmount}`,
  code: 'INSUFFICIENT_LIQUIDITY',
  poolAddress,
  requiredAmount,
  availableAmount,
  statusCode: 400
});

export const createInvalidTokenError = (tokenAddress: string): InvalidTokenError => ({
  message: `Invalid token: ${tokenAddress}`,
  code: 'INVALID_TOKEN',
  tokenAddress,
  statusCode: 400
});

export const createSwapCalculationError = (
  amountIn: string, 
  poolAddress: string, 
  details?: string
): SwapCalculationError => ({
  message: `Failed to calculate swap for amount ${amountIn} in pool ${poolAddress}${details ? `: ${details}` : ''}`,
  code: 'SWAP_CALCULATION_ERROR',
  amountIn,
  poolAddress,
  details: details ? { details } : undefined,
  statusCode: 400
});

export const createTransactionError = (
  message: string, 
  transactionHash?: string, 
  gasUsed?: string
): TransactionError => ({
  message,
  code: 'TRANSACTION_ERROR',
  transactionHash,
  gasUsed,
  statusCode: 500
});

// ---------------- Type Guards ----------------
export function isApiError(error: any): error is ApiError {
  return error && typeof error.message === 'string' && typeof error.code === 'string';
}

export function isValidationError(error: any): error is ValidationError {
  return isApiError(error) && error.code === 'VALIDATION_ERROR';
}

export function isPoolNotFoundError(error: any): error is PoolNotFoundError {
  return isApiError(error) && error.code === 'POOL_NOT_FOUND';
}

export function isInsufficientLiquidityError(error: any): error is InsufficientLiquidityError {
  return isApiError(error) && error.code === 'INSUFFICIENT_LIQUIDITY';
}

export function isInvalidTokenError(error: any): error is InvalidTokenError {
  return isApiError(error) && error.code === 'INVALID_TOKEN';
}

export function isSwapCalculationError(error: any): error is SwapCalculationError {
  return isApiError(error) && error.code === 'SWAP_CALCULATION_ERROR';
}

export function isTransactionError(error: any): error is TransactionError {
  return isApiError(error) && error.code === 'TRANSACTION_ERROR';
}
