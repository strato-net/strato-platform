// Custom error class for Strato blockchain-specific errors
export class StratoError extends Error {
  public status: number;

  constructor(message: string, status: number = 400) {
    super(message);
    this.name = 'StratoError';
    this.status = status;
  }
}