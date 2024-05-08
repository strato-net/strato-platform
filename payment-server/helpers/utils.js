import client from '../db/index.js';
import { rest, util } from "blockapps-rest";
import { ADMIN, CONTRACT_ADDRESS, DEFAULT_OPTIONS } from "./constants.js";
import oauthHelper from './oauthHelper.js';
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

const getStripePaymentFromToken = async (token) => {
  try {
    const query = `
      SELECT sa.accountId, sp.paymentSessionId 
      FROM stripe_payments sp 
      JOIN stripe_accounts sa ON sa.commonName = sp.sellerCommonName
      WHERE token = $1`;
    const values = [ token ];
    const result = await client.query(query, values);
    return result.rows.length === 0 ? undefined : result.rows[0];
  } catch (e) {
    next(e);
  }
}

const getPaymentState = async () => {
  // Refresh JWT token if necessary
  const jwtToken = await oauthHelper.getServiceToken();
  
  const paymentProviderContract = { name: "PaymentService", address: CONTRACT_ADDRESS };
  return await rest.getState(ADMIN, paymentProviderContract, DEFAULT_OPTIONS);
}

const validateAndGetOrderDetails = async (quantities, saleAddresses) => {
  // Refresh JWT token if necessary
  const jwtToken = await oauthHelper.getServiceToken();

  // Get Sale Contracts
  const saleAddressQuery = saleAddresses.map(addr => `address.eq.${addr}`);
  const saleContracts = await rest.search(
    ADMIN, 
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
    ADMIN, 
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

const completeOrder = async (token) => {
  // Refresh JWT token if necessary
  const jwtToken = await oauthHelper.getServiceToken();

  // Make the call and return results
  const contract = { name: "PaymentService", address: CONTRACT_ADDRESS };
  const callArgs = {
    contract,
    method: "completeOrder",
    args: util.usc({ token: token }),
  };
  const completeOrderStatus = await rest.call(ADMIN, callArgs, DEFAULT_OPTIONS);
  return completeOrderStatus;
}

export {
  clientErrorHandler,
  commonErrorHandler,
  getStripeAccountForUser,
  getStripePaymentFromToken,
  getPaymentState,
  validateAndGetOrderDetails,
  completeOrder,
}