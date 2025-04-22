import RestStatus from 'http-status-codes';
import { rest } from 'blockapps-rest';

/**
 * Provides utility middleware for simulating error conditions in routes.
 */
class RouteErrorCheck {
  /**
   * Express middleware designed to simulate error responses based on request parameters.
   * This is likely intended for testing or debugging purposes.
   *
   * It checks for an `error` parameter in the request body (for POST/PUT) or query string (for other methods).
   * - If `error` is `400` (or the string '400'), it sends a 400 Bad Request response using `rest.response.status400`.
   * - If `error` has any other value, it sends a 404 Not Found response using `rest.response.status`.
   *
   * In both error cases, it calls `next()` after sending the response to potentially allow logging or other
   * post-response actions, though the response has already been sent.
   * If no `error` parameter is found, it simply calls `next()` to proceed to the next middleware or route handler.
   *
   * @param {import('express').Request} req - The Express request object.
   * @param {import('express').Response} res - The Express response object.
   * @param {import('express').NextFunction} next - The next middleware function in the stack.
   * @returns {void}
   */
  static checkForError(req, res, next) {
    let error;
    if (req.method === 'POST' || req.method === 'PUT') {
      const { body } = req;
      error = body.error;
    } else {
      const { query } = req;
      error = query.error;
    }
    if (error) {
      if (error === 400 || error === '400') {
        rest.response.status400(res, 'Error Occurred');
        return next();
      }
      rest.response.status(RestStatus.NOT_FOUND, res, 'Error Occurred');
    }
    return next();
  }
}

export default RouteErrorCheck;
