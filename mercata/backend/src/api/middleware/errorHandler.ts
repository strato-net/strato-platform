import { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { StratoError, CirrusError } from "../../errors";

const logError = (label: string, error: any, status?: number, extra?: Record<string, any>) => {
  console.error(`${label}: ${error.message} (${status || error.status})`, ...(extra ? [extra] : []));
  console.error(error.stack);
};

const sendErrorResponse = (res: Response, status: number, type: string, message: string, details?: Record<string, any>) => {
  res.status(status).json({
    error: { message, status, type, ...(details ? { details } : {}) },
  });
};

export const errorHandler: ErrorRequestHandler = (error: any, req: Request, res: Response, next: NextFunction) => {
  if (res.headersSent) {
    return next(error);
  }

  if (error instanceof StratoError) {
    logError('StratoError', error);
    return sendErrorResponse(res, error.status, 'StratoError', error.message);
  }

  if (error instanceof CirrusError) {
    logError('CirrusError', error, error.status, { code: error.code });
    return sendErrorResponse(res, error.status, 'CirrusError', error.message, {
      code: error.code,
      hint: error.hint,
      details: error.details,
    });
  }

  if (error.response?.data && typeof error.response.data === 'object') {
    const { message, code, hint, details } = error.response.data;
    if (message && (code || hint)) {
      const path = error.request?.path || 'unknown';
      logError('CirrusError', error, error.response.status, { code });
      return sendErrorResponse(res, error.response.status, 'CirrusError', message, {
        code, hint, details, path,
      });
    }
  }

  if (error.response?.data && typeof error.response.data === 'string') {
    logError('ApiError', error, error.response.status);
    return sendErrorResponse(res, error.response.status || 400, 'ApiError', error.response.data);
  }

  if (error.name === 'ValidationError') {
    logError('ValidationError', error);
    return sendErrorResponse(res, 400, 'ValidationError', error.message);
  }

  if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
    logError('AuthError', error, 401);
    return sendErrorResponse(res, 401, 'AuthError', 'Invalid or expired token');
  }

  const status = error.status || error.statusCode || 500;
  const message = error.message || "Internal server error";
  logError('ServerError', error, status);
  return sendErrorResponse(res, status, status >= 500 ? 'ServerError' : 'ClientError', message);
};

export const notFoundHandler = (req: Request, res: Response) => {
  if (!res.headersSent) {
    sendErrorResponse(res, 404, 'NotFoundError', 'Route not found');
  }
};