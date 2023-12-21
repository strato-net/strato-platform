const dotenv = require('dotenv');
const { get } = require('lodash');
dotenv.config();

const clientErrorHandler = (err, req, res, next) => {
  const statusCode = get(err, 'statusCode');

  if (statusCode) {
    const message = get(err, 'raw.message');
    console.log(`Unhandled API error. Status: ${statusCode}. Message: ${message}`);
    console.log(`Request: ${req}`);
    console.log(`Response: ${res}`);
    return res.status(statusCode).json({ success: false, error: message });
  }

  return next(err)
}

const commonErrorHandler = (err, req, res, next) => {
  console.log(`Server error. ${err}`);
  console.log(err.stack);
  res.status(500).json({ success: false, error: err });
  return next(err);
}

module.exports = {
  getEnvVariable,
  clientErrorHandler,
  commonErrorHandler,
}