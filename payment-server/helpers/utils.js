import client from '../db/index.js';
import lodash from 'lodash';
const { get } = lodash;

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
  console.log(err.stack);
  res.status(400).json({ success: false, error: err.message });
  return next(err);
}

const getStripeAccountForUser = async (commonName) => {
  try {
    const query = 'SELECT * FROM stripe_accounts WHERE commonName = $1';
    const values = [ commonName ];
    const result = await client.query(query, values);
    return result.rows.length === 0 ? undefined : result.rows[0].accountid;
  } catch (e) {
    next(e);
  }
}

export {
  clientErrorHandler,
  commonErrorHandler,
  getStripeAccountForUser
}