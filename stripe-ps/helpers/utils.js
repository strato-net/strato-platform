const dotenv = require('dotenv');
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

module.exports.getEnvVariable = getEnvVariable;