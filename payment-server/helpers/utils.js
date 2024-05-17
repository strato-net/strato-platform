import client from '../db/index.js';
import { rest, util } from "blockapps-rest";
import { CONTRACT_ADDRESS, DEFAULT_OPTIONS, PAYMENT_EVENT_TABLE } from "./constants.js";
import ADMIN from './oauth.js';
import lodash from 'lodash';
const { get } = lodash;

const clientErrorHandler = (err, req, res, next) => {
  const statusCode = get(err, 'statusCode');

  if (statusCode) {
    const message = get(err, 'raw.message');
    console.log(`Unhandled API error. Status: ${statusCode}. Message: ${message}`);
    console.log(`Request: ${req}`);
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
  const query = 'SELECT * FROM stripe_accounts WHERE commonName = $1';
  const values = [ commonName ];
  const result = await client.query(query, values);
  return result.rows.length === 0 ? undefined : result.rows[0].accountid;
}

const getStripePaymentFromToken = async (token) => {
  const query = `
    SELECT sa.accountId, sp.paymentSessionId, sp.status
    FROM stripe_payments sp 
    JOIN stripe_accounts sa ON sa.commonName = sp.sellerCommonName
    WHERE token = $1`;
  const values = [ token ];
  const result = await client.query(query, values);
  return result.rows.length === 0 ? undefined : result.rows[0];
}

const getStripePaymentsFromTokens = async (tokens) => {
  const query = `
    SELECT sa.accountId, sp.token, sp.paymentSessionId, sp.status
    FROM stripe_payments sp 
    JOIN stripe_accounts sa ON sa.commonName = sp.sellerCommonName
    WHERE token = ANY ($1)`;
  const values = [ tokens ];
  const result = await client.query(query, values);
  return result.rows.length === 0 ? undefined : result.rows[0];
}

const insertStripeAccount = async (commonName, accountId) => {
  const insertQuery = `
    INSERT INTO stripe_accounts (
      commonName,
      accountId
    ) VALUES (
      $1, $2
    )`;
  const insertValues = [ commonName, accountId ];
  const insertResult = await client.query(insertQuery, insertValues);
  return insertResult;
}

const insertStripePayment = async (token, sessionId, sellerCommonName) => {
  const insertQuery = `
    INSERT INTO stripe_payments (
      token,
      paymentSessionId,
      sellerCommonName,
      status
    ) VALUES (
      $1, $2, $3, $4
    )`;
  const insertValues = [ token, sessionId, sellerCommonName, "OPEN" ];
  const insertResult = await client.query(insertQuery, insertValues);
  return insertResult;
}

const updateStripePayment = async (token, status) => {
  const updateQuery = `
    UPDATE stripe_payments
    SET status = $1
    WHERE token = $2`;
  const updateValues = [ status, token ];
  const updateResult = await client.query(updateQuery, updateValues);
  return updateResult;
}

const getPaymentEvent = async (token) => {
  const tableArgs = {
    name: PAYMENT_EVENT_TABLE,
  };
  
  const searchOptions = {
    ...DEFAULT_OPTIONS,
    query: {
      limit: 1,
      ['token']: `eq.${token}`,
    }
  };

  return await rest.search(ADMIN.getUser(), tableArgs, searchOptions);
}

const validateAndGetOrderDetails = async (quantities, saleAddresses) => {
  console.log(quantities, saleAddresses);
  // Get Sale Contracts
  const saleAddressQuery = saleAddresses.map(addr => `address.eq.${addr}`);
  const saleContracts = await rest.search(
    ADMIN.getUser(), 
    { 
      name: 'BlockApps-Mercata-Sale' 
    }, 
    {
      ...DEFAULT_OPTIONS,
      query: {
        ['or']: `(${saleAddressQuery.join(',')})`,
      }
    });

  // Get Asset Contracts
  const assetAddressQuery = saleContracts.map(s => `address.eq.${s.assetToBeSold}`);
  const assetContracts = await rest.search(
    ADMIN.getUser(), 
    { 
      name: 'BlockApps-Mercata-Asset' 
    }, 
    {
      ...DEFAULT_OPTIONS,
      query: {
        ['or']: `(${assetAddressQuery.join(',')})`,
      }
    });

  // Validate that all sale contracts are open
  const sellerCommonName = assetContracts[0].ownerCommonName;
  const openSaleCheck = saleContracts.every(s => s.isOpen === true);
  const sameOwnerCheck = assetContracts.every(a => a.ownerCommonName === sellerCommonName);
  
  // If it passes the checks, return order details else throw error
  if (openSaleCheck && sameOwnerCheck) {
    let orderDetails = [];
    for (let i = 0; i < quantities.length; i++) {
      orderDetails.push({ 
        productName: assetContracts[i].name, 
        unitPrice: saleContracts[i].price, 
        quantity: quantities[i] 
      });
    }
    return { sellerCommonName, orderDetails };
  } else {
    throw new Error(`Order failed to pass the validation. Open Sales Check: ${openSaleCheck} Same Owner Check: ${sameOwnerCheck}`);
  }
}

const completeOrder = async (args) => {
  // Make the call and return results
  const contract = { name: "PaymentService", address: CONTRACT_ADDRESS };
  const callArgs = {
    contract,
    method: "completeOrder",
    args: util.usc({ ...args }),
  };
  const completeOrderStatus = await rest.call(ADMIN.getUser(), callArgs, DEFAULT_OPTIONS);
  return completeOrderStatus;
}

const initializePayment = async (args) => {
  // Make the call and return results
  const contract = { name: "PaymentService", address: CONTRACT_ADDRESS };
  const callArgs = {
    contract,
    method: "initializePayment",
    args: util.usc({ ...args }),
  };
  const completeOrderStatus = await rest.call(ADMIN.getUser(), callArgs, DEFAULT_OPTIONS);
  return completeOrderStatus;
}

const cancelOrder = async (args) => {
  // Make the call and return results
  const contract = { name: "PaymentService", address: CONTRACT_ADDRESS };
  const callArgs = {
    contract,
    method: "cancelOrder",
    args: util.usc({ ...args }),
  };
  const completeOrderStatus = await rest.call(ADMIN.getUser(), callArgs, DEFAULT_OPTIONS);
  return completeOrderStatus;
}

export {
  clientErrorHandler,
  commonErrorHandler,
  getStripeAccountForUser,
  getStripePaymentFromToken,
  getStripePaymentsFromTokens,
  insertStripeAccount,
  insertStripePayment,
  updateStripePayment,
  getPaymentEvent,
  validateAndGetOrderDetails,
  completeOrder,
  initializePayment,
  cancelOrder,
}