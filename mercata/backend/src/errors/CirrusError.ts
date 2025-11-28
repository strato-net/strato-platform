// Custom error class for Cirrus database-specific errors
export class CirrusError extends Error {
  public status: number;
  public code?: string;
  public hint?: string;
  public details?: any;

  constructor(
    message: string,
    status: number = 400,
    code?: string,
    hint?: string,
    details?: any
  ) {
    super(message);
    this.name = 'CirrusError';
    this.status = status;
    this.code = code;
    this.hint = hint;
    this.details = details;
  }
}