import { get } from 'lodash';

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
