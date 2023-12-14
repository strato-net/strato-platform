const dotenv = require('dotenv');
const { get } = require('lodash');
dotenv.config();

/**
 * @param {string} name of the variable to be fetched from env
 * @returns {string} variable value
 */

function getEnvVariable(name) {
  const value = process.env[name] || '';
  if (value == '') throw new Error("Missing env var for " + name);
  return value;
}

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
  return res.status(500).json({ success: false, error: err.message });
}

module.exports = {
  getEnvVariable,
  clientErrorHandler,
  commonErrorHandler,
}