import { rest, util } from 'blockapps-rest';
import ADMIN from './oauth.js'
import { DEFAULT_OPTIONS, ORDER_EVENT_TABLE } from './constants.js';
import lodash from 'lodash';
const { get } = lodash;

const clientErrorHandler = (err, req, res, next) => {
  const statusCode = get(err, 'statusCode');

  if (statusCode) {
    const message = get(err, 'raw.message');
    console.log(`Unhandled API error. Status: ${JSON.stringify(statusCode)}. Message: ${JSON.stringify(message)}`);
    console.log(`Request: ${JSON.stringify(req)}`);
    return res.status(statusCode).json({ success: false, error: message });
  }

  return next(err)
}

const commonErrorHandler = (err, req, res, next) => {
  console.log(err.stack);
  res.status(400).json({ success: false, error: err.message });
  return next(err);
}

const getOrderEvent = async (orderHash) => {
  const tableArgs = {
    name: ORDER_EVENT_TABLE,
  };
  
  const searchOptions = {
    ...DEFAULT_OPTIONS,
    query: {
      limit: 1,
      ['orderHash']: `eq.${orderHash}`,
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

const getMetaMaskAccountForUser = async (commonName) => {
  const query = 'SELECT * FROM metamask WHERE username = $1';
  const values = [ commonName ];
  const result = await client.query(query, values);
  return result.rows.length === 0 ? undefined : result.rows[0].eth_address;
}

export {
  clientErrorHandler,
  commonErrorHandler,
  completeOrder,
  getOrderEvent,
  getMetaMaskAccountForUser,
  validateAndGetOrderDetails
}