import { Request, Response, NextFunction, ErrorRequestHandler } from "express";
import { StratoError } from "../../errors";

// Global error handler middleware
export const errorHandler: ErrorRequestHandler = (error: any, req: Request, res: Response, next: NextFunction) => {
  console.error("Error:", error);
  
  // Check if response has already been sent
  if (res.headersSent) {
    return next(error);
  }
  
  // Handle StratoError specifically
  if (error instanceof StratoError) {
    res.status(error.status).json({
      error: {
        message: error.message,
        status: error.status,
        type: 'StratoError'
      },
    });
    return;
  }
  
  // Handle validation errors (if using express-validator or similar)
  if (error.name === 'ValidationError') {
    res.status(400).json({
      error: {
        message: error.message,
        status: 400,
        type: 'ValidationError'
      },
    });
    return;
  }
  
  // Handle JWT errors
  if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
    res.status(401).json({
      error: {
        message: 'Invalid or expired token',
        status: 401,
        type: 'AuthError'
      },
    });
    return;
  }
  
  // Default error handling
  const status = error.status || error.statusCode || 500;
  const message = error.message || "Internal server error";
  
  res.status(status).json({
    error: {
      message,
      status,
      type: status >= 500 ? 'ServerError' : 'ClientError'
    },
  });
};

// 404 handler for unmatched routes
export const notFoundHandler = (req: Request, res: Response) => {
  // Check if response has already been sent
  if (res.headersSent) {
    return;
  }
  
  res.status(404).json({
    error: {
      message: "Route not found",
      status: 404,
      type: 'NotFoundError'
    },
  });
}; 