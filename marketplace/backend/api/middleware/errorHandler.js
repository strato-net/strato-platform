import { get } from 'lodash';

/**
 * Express error handling middleware specifically for errors originating from client requests
 * or interactions with external APIs (e.g., Axios errors).
 * It checks for a `response` object attached to the error, typically indicating an HTTP error
 * from an external service.
 *
 * If such an error is found, it logs the details and sends a JSON response to the client
 * with the status code and message from the external response.
 *
 * Otherwise, it passes the error to the next error handling middleware.
 *
 * @param {Error & { response?: { status?: number, statusText?: string, data?: any } }} err - The error object. May contain a `response` property for HTTP errors.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @param {import('express').NextFunction} next - The next middleware function in the stack.
 */
const clientErrorHandler = (err, req, res, next) => {
  const statusCode = get(err, 'response.status');

  if (statusCode) {
    const statusText = get(err, 'response.statusText');
    const message = get(err, 'response.data');
    console.log(
      `Unhandled API error. Status: ${JSON.stringify(statusCode)} ${JSON.stringify(statusText)}. Message: ${JSON.stringify(message)}`
    );
    return res.status(statusCode).json({ success: false, error: statusText });
  }

  return next(err);
};

/**
 * A more general Express error handling middleware.
 * It checks if the error object has a `res.statusCode` property, which might be set by previous middleware.
 *
 * If a status code is found, it logs the error details and sends a JSON response to the client.
 *
 * If no specific status code is found on the error, it logs the full error stack trace (indicating a likely
 * unhandled server error) and passes the error to the next error handling middleware (or Express's default handler).
 *
 * @param {Error & { res?: { statusCode?: number, statusText?: string, statusMessage?: string } }} err - The error object. May contain a `res` property with status info.
 * @param {import('express').Request} req - The Express request object.
 * @param {import('express').Response} res - The Express response object.
 * @param {import('express').NextFunction} next - The next middleware function in the stack.
 */
const commonErrorHandler = (err, req, res, next) => {
  const statusCode = get(err, 'res.statusCode');

  if (statusCode) {
    const statusText = get(err, 'res.statusText');
    const message = get(err, 'res.statusMessage');
    console.log(
      `Server error. Status: ${JSON.stringify(statusCode)} ${JSON.stringify(statusText)}. Message: ${JSON.stringify(message)}`
    );
    return res.status(statusCode).json({ success: false, error: statusText });
  }

  console.log(err.stack);
  return next(err);
};

export default { clientErrorHandler, commonErrorHandler };
