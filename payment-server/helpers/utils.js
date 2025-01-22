import client from "../db/index.js";
import { rest, util } from "blockapps-rest";
import {
  DEFAULT_OPTIONS,
  CHECKOUT_EVENT_TABLE,
  SELLER_ONBOARDED_TABLE,
  TABLE_PREFIX,
  STRIPE_CONTRACT_ADDRESS,
  USDST_ADDRESS,
} from "./constants.js";
import ADMIN from "./oauth.js";
import lodash from "lodash";
const { get } = lodash;
import oauthHelper from "./oauthHelper.js";
import axios from "axios";
import BigNumber from "bignumber.js";

// Fetches Asset Name based on sale address
const getAsset = async(saleAddress)=>{
  //fetch asset address
  const assetToBeSold= await rest.search(
                                        ADMIN.getUser()
                                      , {name : `${TABLE_PREFIX}Sale`}
                                      , {
                                        ...DEFAULT_OPTIONS,
                                        query: {
                                          limit: 1
                                        ,  ['address']: `eq.${saleAddress}`
                                        ,  select:"assetToBeSold"
                                        }
                                    });
  //fetch asset name
  const tableArgs = { name: `${TABLE_PREFIX}Asset` };

  const searchOptions = {
    ...DEFAULT_OPTIONS,
    query: {
      limit: 1,
      ['address']: `eq.${assetToBeSold[0].assetToBeSold}`,
      select:"name,data"
    }
  }

  return await rest.search(ADMIN.getUser(), tableArgs, searchOptions);
}

// Prepare the orderData array
const prepareOrderData = (orderDetails, assetData) => {
  return orderDetails.map((order, index) => {
    const unitPrice = order.amount / order.quantitiesToBePurchased[0];
    return {
      root: assetData[index].root,
      name: assetData[index].name,
      unitPrice: unitPrice,
      qty: order.quantitiesToBePurchased[0],
      tax: 0
    };
  });
};

const sendEmail = async(to, subject, htmlContent) => {

  const url = process.env.NOTIFICATION_SERVER_URL
  const {token } = await oauthHelper.getServiceToken()
  const reqBody = {
    usernames: [to],
    message: {
      subject: subject,
      htmlContent: htmlContent
    }
  };
  try {
    const response = await axios.post(`${url}/notify`, reqBody, {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    });

    if (response.status === 200 || response.status === 201) {
      console.log("Email sent successfully");
    }

  } catch (error) {
    console.error("Error sending email:", error);
  }
}

const clientErrorHandler = (err, req, res, next) => {
  const statusCode = get(err, 'statusCode');

  if (statusCode) {
    const message = get(err, 'raw.message');
    res.redirect(`${req.query.redirectUrl}?error=${encodeURIComponent(err.message)}`);

    console.log(`Unhandled API error. Status: ${JSON.stringify(statusCode)}. Message: ${JSON.stringify(message)}`);
  }

  return next(err)
}

const commonErrorHandler = (err, req, res, next) => {
  res.redirect(`${req.query.redirectUrl}?error=${encodeURIComponent(err.message)}`);
  return next(err);
}

const verifyDatabaseConnection = async () => {
  const query = 'SELECT * FROM stripe_accounts LIMIT 1';
  const result = await client.query(query);
  console.log(result);
}

const getStripeAccountForUser = async (commonName) => {
  const query = 'SELECT * FROM stripe_accounts WHERE commonName = $1';
  const values = [ commonName ];
  const result = await client.query(query, values);
  return result.rows.length === 0 ? undefined : result.rows[0].accountid;
}

const getStripePaymentFromToken = async (orderHash) => {
  const query = `
    SELECT sa.accountId, sp.paymentSessionId, sp.status
    FROM stripe_payments sp 
    JOIN stripe_accounts sa ON sa.commonName = sp.sellerCommonName
    WHERE orderHash = $1`;
  const values = [ orderHash ];
  const result = await client.query(query, values);
  return result.rows.length === 0 ? undefined : result.rows[0];
}

const getStripePaymentsFromTokens = async (orderHashes) => {
  const query = `
    SELECT sa.accountId, sp.orderHash, sp.paymentSessionId, sp.status
    FROM stripe_payments sp 
    JOIN stripe_accounts sa ON sa.commonName = sp.sellerCommonName
    WHERE orderHash = ANY ($1)`;
  const values = [ orderHashes ];
  const result = await client.query(query, values);
  return result.rows.length === 0 ? undefined : result.rows;
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

const insertStripePayment = async (orderHash, sessionId, sellerCommonName) => {
  const insertQuery = `
    INSERT INTO stripe_payments (
      orderHash,
      paymentSessionId,
      sellerCommonName,
      status
    ) VALUES (
      $1, $2, $3, $4
    )`;
  const insertValues = [ orderHash, sessionId, sellerCommonName, "OPEN" ];
  const insertResult = await client.query(insertQuery, insertValues);
  return insertResult;
}

const updateStripePayment = async (orderHash, status) => {
  const updateQuery = `
    UPDATE stripe_payments
    SET status = $1
    WHERE orderHash = $2`;
  const updateValues = [ status, orderHash ];
  const updateResult = await client.query(updateQuery, updateValues);
  return updateResult;
}

const validatePaymentServiceContract = async (address) => {
  try {
    const contract = { name: "PaymentService", address };
    const res = await rest.getState(ADMIN.getUser(), contract, DEFAULT_OPTIONS);
  } catch (e) {
    console.error(`Contract could not be found at address ${address}. Now exiting...\nMessage: ${e}`);
    process.exit(1);
  }
}

const validateRedemptionServiceContract = async (address) => {
  try {
    const contract = { name: "RedemptionService", address };
    const res = await rest.getState(ADMIN.getUser(), contract, DEFAULT_OPTIONS);
  } catch (e) {
    console.error(`Contract could not be found at address ${address}. Now exiting...\nMessage: ${e}`);
    process.exit(1);
  }
}

const emitOnboardSeller = async (address, args) => {
  // Make the call and return results
  const contract = { name: "PaymentService", address };
  const callArgs = {
    contract,
    method: "onboardSeller",
    args: util.usc({ ...args }),
  };
  const onboardSellerStatus = await rest.call(ADMIN.getUser(), callArgs, DEFAULT_OPTIONS);
  return onboardSellerStatus;
}

const getCheckoutEvent = async (checkoutHash) => {
  const tableArgs = {
    name: CHECKOUT_EVENT_TABLE,
  };
  
  const searchOptions = {
    ...DEFAULT_OPTIONS,
    query: {
      limit: 1,
      ['checkoutHash']: `eq.${checkoutHash}`,
    }
  };

  return await rest.searchUntil(ADMIN.getUser(), tableArgs, (r) => r.length === 1, searchOptions);
}

const checkSellerOnboarded = async (commonName) => {
  const tableArgs = {
    name: SELLER_ONBOARDED_TABLE,
  };

  const searchOptions = {
    ...DEFAULT_OPTIONS,
    query: {
      limit: 1,
      ['sellersCommonName']: `eq.${commonName}`,
      ['address']: `eq.${STRIPE_CONTRACT_ADDRESS}`,
      ['order']: `id.desc`
    }
  }

  return await rest.search(ADMIN.getUser(), tableArgs, searchOptions);
}

const validateAndGetOrderDetails = async (quantities, saleAddresses) => {
  // Get Sale Contracts
  const saleAddressQuery = saleAddresses.map(addr => `address.eq.${addr}`);
  const saleContracts = await rest.search(
    ADMIN.getUser(), 
    { 
      name: `${TABLE_PREFIX}Sale` 
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
      name: `${TABLE_PREFIX}Asset`
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
      const decimalPlaces =
        assetContracts[i].root === USDST_ADDRESS ? 18 : 0;

      const unitPrice = new BigNumber(saleContracts[i].price);
      const quantity = new BigNumber(quantities[i]);
      const multiplier = new BigNumber(10).pow(decimalPlaces);

      orderDetails.push({
        productName: assetContracts[i].name,
        unitPrice: Number(unitPrice.multipliedBy(multiplier).toFixed(2)),
        quantity: Number(quantity.dividedBy(multiplier).toString()),
        firstSale:
          assetContracts[i].address === assetContracts[i].originAddress,
      });
    }
    return { sellerCommonName, orderDetails };
  } else {
    throw new Error(`Order failed to pass the validation. Open Sales Check: ${openSaleCheck} Same Owner Check: ${sameOwnerCheck}`);
  }
}

const completeOrder = async (address, args) => {
  // Make the call and return results
  const contract = { name: "PaymentService", address };
  const callArgs = {
    contract,
    method: "completeOrder",
    args: util.usc({ ...args }),
  };
  const completeOrderStatus = await rest.call(ADMIN.getUser(), callArgs, DEFAULT_OPTIONS);
  return completeOrderStatus;
}

const generateIntermediateOrder = async (address, args) => {
  // Make the call and return results
  const contract = { name: "PaymentService", address };
  const callArgs = {
    contract,
    method: "generateIntermediateOrder",
    args: util.usc({ ...args }),
  };
  const completeOrderStatus = await rest.call(ADMIN.getUser(), callArgs, DEFAULT_OPTIONS);
  return completeOrderStatus;
}

const cancelOrder = async (address, args) => {
  // Make the call and return results
  const contract = { name: "PaymentService", address };
  const callArgs = {
    contract,
    method: "cancelOrder",
    args: util.usc({ ...args }),
  };
  const cancelOrderStatus = await rest.call(ADMIN.getUser(), callArgs, DEFAULT_OPTIONS);
  return cancelOrderStatus;
}

const discardCheckoutQuantity = async (address, args) => {
  // Make the call and return results
  const contract = { name: "PaymentService", address };
  const callArgs = {
    contract,
    method: "discardCheckoutQuantity",
    args: util.usc({ ...args }),
  };
  const discardOrderStatus = await rest.call(ADMIN.getUser(), callArgs, DEFAULT_OPTIONS);
  return discardOrderStatus;
}

export {
  clientErrorHandler,
  commonErrorHandler,
  verifyDatabaseConnection,
  getStripeAccountForUser,
  getStripePaymentFromToken,
  getStripePaymentsFromTokens,
  insertStripeAccount,
  insertStripePayment,
  updateStripePayment,
  validatePaymentServiceContract,
  validateRedemptionServiceContract,
  emitOnboardSeller,
  getCheckoutEvent,
  checkSellerOnboarded,
  validateAndGetOrderDetails,
  completeOrder,
  generateIntermediateOrder,
  cancelOrder,
  discardCheckoutQuantity,
  getAsset,
  sendEmail,
  prepareOrderData,
}