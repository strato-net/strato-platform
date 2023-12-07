import { rest, util, importer } from "blockapps-rest";
const { createContract } = rest;
import constants, { CHARGES, ITEM_STATUS, ORDER_STATUS, SERVICE_PROVIDERS, PAYMENT_TYPES } from "/helpers/constants";
import { yamlWrite, yamlSafeDumpSync, getYamlFile } from "/helpers/config";
import { pollingHelper } from "/helpers/utils";

import StripeService from "/payment-service/stripe.service";
import dayjs from 'dayjs';
import RestStatus from 'http-status-codes';
import certificateJs from "/dapp/certificates/certificate";

import artJs from "/dapp/items/art";
import carbonJs from "/dapp/items/carbon";
import metalsJs from "/dapp/items/metals";
import clothingJs from "/dapp/items/clothing";

import saleJs from "/dapp/orders/sale";
import saleOrderJs from "/dapp/orders/saleOrder";

import inventoryJs from "/dapp/products/inventory";
import marketplaceJs from "/dapp/marketplace/marketplace.js";
import userAddressJs from "/dapp/addresses/userAddress.js";
import paymentManagerJs from "/dapp/payments/paymentManager";
import paymentProviderJs from '/dapp/payments/paymentProvider';

const allAssetNames = [];

const contractName = "Dapp";
const contractFileName = `dapp/dapp/contracts/Dapp.sol`;

const balance = 100000000000000000000;
let userCert = null;

// interface Member {
//   access?:boolean,
//   orgName?:string,
//   orgUnit?:string,
//   commonName?:string
// }

function deploy(contract, args, options) {
  console.log(options);
  // author the deployment
  const { deployFilePath } = args;

  const deployment = {
    url: options.config.nodes[0].url,
    dapp: {
      contract: {
        name: contract.name,
        address: contract.address
      },
    },
  };

  if (options.config.apiDebug) {
    console.log("deploy filename:", deployFilePath);
    console.log(yamlSafeDumpSync(deployment));
  }

  yamlWrite(deployment, deployFilePath);

  return deployment;
}

async function loadFromDeployment(admin, deployFilename, options) {
  const deployFile = getYamlFile(deployFilename);
  return await bind(admin, deployFile.dapp.contract, {
    ...options,
  });
}

async function uploadDappContract(token, options) {
  const source = await importer.combine(contractFileName);
  const contractArgs = {
    name: contractName,
    source,
    args: {},
  };

  const copyOfOptions = {
    ...options,
    history: [contractName, ...allAssetNames],
  };

  const contract = await createContract(token, contractArgs, copyOfOptions);
  contract.src = "removed";

  return await bind(token, contract, options);
}

async function uploadContract(token, options) {
  const source = await importer.combine(contractFileName);
  const contractArgs = {
    name: contractName,
    source,
    args: {},
  };

  const copyOfOptions = {
    ...options,
    history: [contractName],
  };

  const contract = await createContract(token, contractArgs, options);
  contract.src = "removed";

  return await bind(token, contract, options);
}

async function getManagersAndCirrusInfo(admin, contract, options) {
  const state = await rest.getState(admin, contract, options);
  const paymentManager = await paymentManagerJs.bindAddress(admin, state.paymentManager, options);

  const cirrusOrg = state.bootUserOrganization !== "" ? state.bootUserOrganization : undefined;

  return { cirrusOrg, paymentManager };
}

async function bind(rawAdmin, _contract, _defaultOptions, serviceUser = false) {
  const contract = _contract;
  console.debug(contract)
  let userOrganization

  if (!serviceUser) {

    let userCertificate = await pollingHelper(certificateJs.getCertificateMe, [rawAdmin]);

    //We are not guaranteed the user will have a certificate
    //99% chance they do, but if this this their first login
    //the node might not have a certificate in time
    if (!(userCertificate === null || userCertificate === undefined || userCertificate.organization === null || userCertificate.organization === undefined)) {
      contract.userOrganization = userCertificate.organization
      userOrganization = userCertificate.organization
      userCert = userCertificate;//Attaching user cert to dapp to save from needing make another call to get it
      console.log('dapp - userCertificate.organization', userCertificate.organization)
    }
  }

  const managers = await getManagersAndCirrusInfo(rawAdmin, contract, _defaultOptions)
  // includes the org+app for cirrus namespacing (helpers/utils.js will prepend to cirrus queries)
  const defaultOptions = { ..._defaultOptions, app: contractName, chainIds: [], };
  // for querying data not on the dapp shard
  const optionsNoChainIds = {
    ...defaultOptions,
    chainIds: [],
  };

  const dappAddress = contract.address;
  const admin = { dappAddress, ...rawAdmin };

  contract.managers = managers;
  contract.chainId = defaultOptions.chainIds
    ? defaultOptions.chainIds[0]
    : undefined;

  // --------------------------- DAPP MANAGEMENT --------------------------------
  // governance - single add
  contract.addOrg = async function (orgName) {
    return addOrg(admin, contract, defaultOptions, orgName);
  };
  contract.addOrgUnit = async function (orgName, orgUnit) {
    return addOrgUnit(admin, contract, defaultOptions, orgName, orgUnit);
  };
  contract.addMember = async function (orgName, orgUnit, commonName) {
    return addMember(admin, contract, defaultOptions, orgName, orgUnit, commonName);
  };
  contract.removeOrg = async function (orgName) {
    return removeOrg(admin, contract, defaultOptions, orgName);
  };
  contract.removeOrgUnit = async function (orgName, orgUnit) {
    return removeOrgUnit(admin, contract, defaultOptions, orgName, orgUnit);
  };
  contract.removeMember = async function (orgName, orgUnit, commonName) {
    return removeMember(admin, contract, defaultOptions, orgName, orgUnit, commonName);
  };

  // governance - multiple adds
  contract.addOrgs = async function (orgNames) {
    return addOrgs(admin, contract, defaultOptions, orgNames);
  };
  contract.addOrgUnits = async function (orgNames, orgUnits) {
    return addOrgUnits(admin, contract, defaultOptions, orgNames, orgUnits);
  };
  contract.addMembers = async function (orgNames, orgUnits, commonNames) {
    return addMembers(admin, contract, defaultOptions, orgNames, orgUnits, commonNames);
  };
  contract.removeOrgs = async function (orgNames) {
    return removeOrgs(admin, contract, defaultOptions, orgNames);
  };
  contract.removeOrgUnits = async function (orgNames, orgUnits) {
    return removeOrgUnits(admin, contract, defaultOptions, orgNames, orgUnits);
  };
  contract.removeMembers = async function (orgNames, orgUnits, commonNames) {
    return removeMembers(admin, contract, defaultOptions, orgNames, orgUnits, commonNames);
  };

  // state and deployment
  contract.getState = async function () {
    return rest.getState(admin, contract, defaultOptions);
  };
  contract.deploy = function (args, options = defaultOptions) {
    const deployment = deploy(contract, args, options);
    return deployment;
  };

  // -------------------------- CERTIFICATES --------------------------------
  contract.getCertificate = async function (args) {
    return certificateJs.getCertificate(admin, args);
  };
  contract.getCertificateMe = (!(userCert === null || userCert === undefined)) ? userCert : async function () {
    return certificateJs.getCertificateMe(admin);
  };
  contract.getCertificates = async function (args) {
    return certificateJs.getCertificates(admin, args);
  };

  // -------------------------- INVENTORY --------------------------------
  
  contract.getInventory = async function (args, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName, };
    return inventoryJs.get(rawAdmin, { ...args }, getOptions);
  };

  contract.getInventories = async function (args, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName };
    const inventories = await inventoryJs.getAll(rawAdmin, { ...args, ownerCommonName: userCert.commonName, sort: '-createdDate' }, getOptions);
    const inventoryCount = await inventoryJs.inventoryCount(rawAdmin, { ...args, ownerCommonName: userCert.commonName, sort: '-createdDate', status: [1,2] }, getOptions);
    return {inventories: inventories, inventoryCount: inventoryCount}
  };

  contract.resellItem = async function (args, options = defaultOptions) {
    const { itemContract, itemAddress, ...restArgs } = args;
    const contract = { name: itemContract, address: itemAddress };
    return inventoryJs.resellItem(rawAdmin, contract, restArgs, options);
  }

  contract.updateItem = async function (args, options = defaultOptions) {
    const { itemContract, itemAddress, ...restArgs} = args;
    const contract = { name: itemContract, address: itemAddress };
    return inventoryJs.updateItem(rawAdmin, contract, restArgs, options);
  }

  // ------------------------------ INVENTORY ENDS--------------------------------

  contract.getMarketplaceInventories = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName };
    return marketplaceJs.getAll(rawAdmin, { ...args }, getOptions);
  };

  contract.getMarketplaceInventoriesLoggedIn = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName };
    return marketplaceJs.getAll(rawAdmin, { ...args, notEqualsField: 'ownerOrganization', notEqualsValue: userOrganization }, getOptions);
  };

  contract.getTopSellingProducts = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName }
    return marketplaceJs.getTopSellingProducts(rawAdmin, { ...args }, getOptions)
  }

  contract.getTopSellingProductsLoggedIn = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName }
    return marketplaceJs.getTopSellingProducts(rawAdmin, { ...args, notEqualsField: 'ownerOrganization', notEqualsValue: userOrganization }, getOptions)
  }

  // ------------------------------ ART STARTS ------------------------------

  contract.createArt = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    const newArgs = {
      ...args.itemArgs,
      createdDate,
      owner: rawAdmin.address,
    };
    return artJs.uploadContract(rawAdmin, newArgs, options);
  };

  contract.getArts = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName, };
    return artJs.getAll(rawAdmin, args, getOptions);
  };

  // contract.transferOwnershipArt = async function (args, options = defaultOptions) {
  //   const { address, chainId, newOwner } = args;
  //   const contract = { name: artJs.contractName, address: address, };
  //   const chainOptions = { chainIds: [chainId], ...options };
  //   return artJs.transferOwnership(rawAdmin, contract, chainOptions, newOwner);
  // };

  // contract.updateArt = async function (args, options = defaultOptions) {
  //   const { address, chainId, updates } = args;
  //   const contract = { name: artJs.contractName, address: address, };
  //   const chainOptions = { chainIds: [chainId], ...options };
  //   return artJs.update(rawAdmin, contract, updates, chainOptions);
  // };
  // ------------------------------ ART ENDS --------------------------------

  // ------------------------------ CARBON STARTS------------------------------

  contract.createCarbon = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    const newArgs = {
      ...args.itemArgs,
      createdDate,
      owner: rawAdmin.address,
      status: 1,
    };
    return carbonJs.uploadContract(rawAdmin, newArgs, options);
  };

  contract.getCarbons = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName, };
    return carbonJs.getAll(rawAdmin, args, getOptions);
  };

  // ------------------------------ CARBON ENDS--------------------------------

  // ------------------------------ METALS STARTS------------------------------

  contract.createMetals = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    const newArgs = {
      ...args.itemArgs,
      createdDate,
      owner: rawAdmin.address,
    };
    return metalsJs.uploadContract(rawAdmin, newArgs, options);
  };

  contract.getMetals = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName, };
    return metalsJs.getAll(rawAdmin, args, getOptions);
  };

  // ------------------------------ MATERIALS ENDS--------------------------------

  // ------------------------------ CLOTHING STARTS------------------------------

  contract.createClothing = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    const newArgs = {
      ...args.itemArgs,
      createdDate,
      owner: rawAdmin.address,
      status: 1
    };
    return clothingJs.uploadContract(rawAdmin, newArgs, options);
  };

  contract.getClothings = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName, };
    return clothingJs.getAll(rawAdmin, args, getOptions);
  };

  // ------------------------------ CLOTHING ENDS--------------------------------

  // ------------------------------ SALE TEST STARTS ------------------------------

  contract.createSaleOrder = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    const { orderList, paymentMethod, ...restArgs } = args;
    const assetAddresses = orderList.map(asset => {
      return asset.assetAddress;
    })
    const sales = await saleJs.getAll(rawAdmin, { assetAddresses, paymentMethod }, options);
    const sellersAddress = sales[0].sellersAddress;
    const sellersCommonName = sales[0].sellersCommonName;
    const saleAddresses = await Promise.all(sales.map(async (sale) => {
      const orderForSale = orderList.find(order => order.assetAddress === sale.assetToBeSold);
      const saleData = JSON.parse(sale.data);
      if (saleData.units && orderForSale.quantity < saleData.units) {
        const contract = { name: orderForSale.category, address: orderForSale.assetAddress }
        const splitSaleAddress = await saleJs.createSplitSale(rawAdmin, { 
          paymentType: parseInt(PAYMENT_TYPES[paymentMethod]), 
          price: sale.price, 
          units: orderForSale.quantity,
        }, options, contract);
        return splitSaleAddress;
      }
      else {
        return sale.address;
      }
    }));
    const newArgs = {
      ...restArgs,
      saleAddresses,
      sellersCommonName,
      sellersAddress,
      purchasersCommonName: userCert.commonName,
      purchasersAddress: rawAdmin.address,
      orderId: util.uid(),
      createdDate: createdDate,
    }
    return saleOrderJs.uploadContract(rawAdmin, newArgs, options);
  }

  contract.cancelSaleOrder = async function (args, options = defaultOptions) {
    const { saleOrderAddress, comments, ...restArgs } = args;
    const contract = { name: saleOrderJs.contractName, address: saleOrderAddress }
    return saleOrderJs.cancelOrder(rawAdmin, contract, options, comments);
  }

  contract.getSaleOrders = async function (args, options = defaultOptions) {
    const getOptions = { ...options, app: contractName, };
    return saleOrderJs.getAll(rawAdmin, args, getOptions);
  }

  contract.getOrder = async function (args, options = defaultOptions) {
    try {
      const order = await saleOrderJs.get(rawAdmin, args, options);
      const getOptions = { ...options, org: managers.cirrusOrg, app: contractName };
      const userContactAddress = await userAddressJs.get(rawAdmin, { address: order.shippingAddress }, getOptions);
      const sales = await saleJs.getAll(rawAdmin, { saleAddresses: order.saleAddresses, state: [1,2] }, options);
      const assetAddresses = sales.map(sale => {
        return sale.assetToBeSold;
      })
      let assets = [];
      const assetsWithoutQuantity = await inventoryJs.getAll(rawAdmin, { assetAddresses: assetAddresses }, options);
      assetsWithoutQuantity.map(asset => {
        const saleForAsset = sales.find(sale => sale.assetToBeSold === asset.address);
        const saleData = JSON.parse(saleForAsset.data);
        const quantity = saleData.units ? saleData.units : 1;
        assets.push({
          ...asset,
          price: saleForAsset.price,
          quantity: quantity,
          amount: quantity * saleForAsset.price,
        })
      })
      const result = { userContactAddress, order, assets };

      return result;
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while fetching the order");
    }
  };

  contract.cancelSaleOrder = async function (args, options = defaultOptions) {
    const { saleOrderAddress, comments, ...restArgs } = args;
    const contract = { name: saleOrderJs.contractName, address: saleOrderAddress }
    return saleOrderJs.cancelOrder(rawAdmin, contract, options, comments);
  }

  contract.saleOrderTransferOwnership = async function (args, options = defaultOptions) {
    const { saleOrderAddress, fulfillmentDate, comments, ...restArgs } = args;
    const contract = { name: saleOrderJs.contractName, address: saleOrderAddress }
    return saleOrderJs.transferOwnership(rawAdmin, contract, options, fulfillmentDate, comments);
  };

  // ------------------------------ SALE TEST ENDS ------------------------------


  /* ------------------------ Stripe account connect starts here ------------------------ */
  contract.stripeOnboarding = async function (args, options = defaultOptions) {
    try {
      const getOptions = { ...options, org: managers.cirrusOrg, app: contractName };
      let userStripeAccount, generatedAccountLink;
      // get user paymentProvider details from cirrus
      const sellerStripeDetails = await paymentProviderJs.get(rawAdmin, { name: SERVICE_PROVIDERS.STRIPE, ownerOrganization: userOrganization, accountDeauthorized: false }, getOptions)

      /*  check if an accountId already exists for the user org */
      if (Object.keys(sellerStripeDetails).length > 0 && sellerStripeDetails.accountLinked) {
        throw new rest.RestError(RestStatus.CONFLICT, "User has already connected their stripe account.")
      }

      if (Object.keys(sellerStripeDetails).length == 0) {
        userStripeAccount = await StripeService.generateStripeAccountId();
        // save generated account id
        const accountDetails = {
          name: SERVICE_PROVIDERS.STRIPE,
          accountId: userStripeAccount.id, status: "", createdDate: dayjs().unix(),
        }
        userStripeAccount = userStripeAccount.id
        await managers.paymentManager.createPaymentProvider(accountDetails)
      } else {
        userStripeAccount = sellerStripeDetails.accountId
      }
      const connectLink = StripeService.generateStripeAccountConnectLink(userStripeAccount);
      return connectLink
    } catch (error) {
      console.error(`${error}`)
      throw new rest.RestError(RestStatus.BAD_REQUEST, `${error.message}`)
    }
  }

  contract.getStripeOnboardingStatus = async function (args, options = defaultOptions) {
    try {
      const getOptions = { ...options, org: managers.cirrusOrg, app: contractName };

      // get user paymentProvider details from cirrus
      const paymentProvider = await paymentProviderJs.get(rawAdmin, { name: SERVICE_PROVIDERS.STRIPE, accountDeauthorized: false, ...args }, getOptions);

      /* TODO check if the provider contract exists on then initiate a update */
      if (Object.keys(paymentProvider).length == 0) {
        // throw new rest.RestError(RestStatus.NOT_FOUND, "User hasn't started their stripe setup.")
        return {}
      }
      const connectedStripeAccountStatus = { accountId: paymentProvider.accountId, paymentProviderAddress: paymentProvider.address, chargesEnabled: false, detailsSubmitted: false, payoutsEnabled: false, accountDeauthorized: false, eventTime: Date.now() }

      try {
        const userStripeAccount = await StripeService.getStripeConnectAccountDetail(paymentProvider.accountId);
        connectedStripeAccountStatus.chargesEnabled = userStripeAccount.charges_enabled
        connectedStripeAccountStatus.detailsSubmitted = userStripeAccount.details_submitted
        connectedStripeAccountStatus.payoutsEnabled = userStripeAccount.payouts_enabled

      } catch (error) {
        if (error.code == 'account_invalid') {
          connectedStripeAccountStatus.accountDeauthorized = true
        }
      }
      const { detailsSubmitted, chargesEnabled, payoutsEnabled, accountDeauthorized } = connectedStripeAccountStatus
      if (paymentProvider.detailsSubmitted !== detailsSubmitted || paymentProvider.chargesEnabled !== chargesEnabled || paymentProvider.payoutsEnabled !== payoutsEnabled || paymentProvider.accountDeauthorized !== accountDeauthorized) {
        await managers.paymentManager.updatePaymentProvider(connectedStripeAccountStatus, options)
      }

      return connectedStripeAccountStatus

    } catch (error) {
      console.error(`${error}`)
      throw new rest.RestError(RestStatus.BAD_REQUEST, `${error.message}`)
    }
  }

  contract.updateStripeOnboardingStatus = async function (args, options = defaultOptions) {
    try {
      // get user paymentProvider details from cirrus
      const { accountId, chargesEnabled, detailsSubmitted, payoutsEnabled, accountDeauthorized, eventTime } = args

      const getOptions = { ...options, org: managers.cirrusOrg, app: contractName };
      const chainOptions = { ...options, chainIds: [contract.chainId] };

      const paymentProvider = await paymentProviderJs.get(rawAdmin, { name: SERVICE_PROVIDERS.STRIPE, accountId }, getOptions);

      /* TODO check if the provider contract exists on then initiate a update */
      if (!paymentProvider) {
        // throw new rest.RestError(RestStatus.NOT_FOUND, "User hasn't started their stripe setup.")
        return false
      }

      if (paymentProvider.eventTime > eventTime) {
        return true;
      }

      await managers.paymentManager.updatePaymentProvider({ paymentProviderAddress: paymentProvider.address, chargesEnabled, detailsSubmitted, payoutsEnabled, accountDeauthorized, eventTime }, chainOptions)

    } catch (error) {
      console.error(error);
      throw new rest.RestError(error.response.status, error.response.statusText)
    }
  }
  // //-----------------------------PAYMENT starts here -------------------------------

  contract.paymentCheckout = async function (args, options = defaultOptions) {
    try {

      const { orderList, orderTotal: recievedOrderTotal } = args;

      const newOptions = { ...options, org: managers.cirrusOrg, app: contractName }

      const assetAddresses = orderList.map(o => o.assetAddress);
      
      const assets = await inventoryJs.getAll(rawAdmin, { assetAddresses: assetAddresses, status: 1 }, options);

      if (assets.length == 0 || assets.length != orderList.length) {
        throw new rest.RestError(RestStatus.NOT_FOUND, "Inventory not found")
      }

      const inventoryOrganization = assets[0].ownerOrganization;
      const sellerName = assets[0].ownerCommonName;
      for (const currInventory of assets) {

        if (currInventory.ownerCommonName == userCert.commonName) {
          throw new rest.RestError(RestStatus.BAD_REQUEST, "Seller cannot buy his own product",);
        }

        /* User shouldn't be allowed buy products from multiple sellers  */
        if (sellerName != currInventory.ownerCommonName) {
          throw new rest.RestError(RestStatus.BAD_REQUEST, "Cannot buy products from multiple sellers in the same Order/Checkout",);
        }
      }
      // const chainOptions = { ...options, chainIds: [contract.chainId] };
      const sellerStripeDetails = await paymentProviderJs.get(rawAdmin,
        {
          name: SERVICE_PROVIDERS.STRIPE, ownerOrganization: inventoryOrganization,
          accountDeauthorized: false
        },
        newOptions)

      /*  check if an accountId already exists for the user org */
      if (Object.keys(sellerStripeDetails).length == 0 || !sellerStripeDetails.chargesEnabled || !sellerStripeDetails.detailsSubmitted || !sellerStripeDetails.payoutsEnabled) {
        throw new rest.RestError(RestStatus.CONFLICT, "Seller hasn't activated this payment method")
      }

      const invoices = []; let calculatedOrderTotal = 0

      orderList.forEach(item => {
        const inventoryItem = assets.find(asset => asset.address == item.assetAddress);
        invoices.push({ productName: decodeURIComponent(inventoryItem.name), unitPrice: inventoryItem.price, quantity: item.quantity })

        calculatedOrderTotal += (inventoryItem.price * item.quantity)
      })

      if (calculatedOrderTotal != recievedOrderTotal) {
        throw new rest.RestError(RestStatus.BAD_REQUEST, "Incorrect order value.")
      }
      let stripePaymentSession;
      try {

        stripePaymentSession = await StripeService.initiatePayment(args, invoices, sellerStripeDetails.accountId);
      } catch (err) {
        throw new rest.RestError(err.statusCode, err.message)
      }
      const paymentParameters = {
        paymentSessionId: stripePaymentSession.id,
        paymentProvider: "stripe",
        paymentStatus: stripePaymentSession.payment_status,
        sessionStatus: stripePaymentSession.status,
        amount: stripePaymentSession.amount_total.toString(),
        expiresAt: stripePaymentSession.expires_at,
        createdDate: stripePaymentSession.created,
        sellerAccountId: sellerStripeDetails.accountId
      }
      const paymentContract = await managers.paymentManager.createPayment(paymentParameters)
      return stripePaymentSession

    } catch (error) {
      console.log(error);
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while updating the order");
    }
  };

  contract.updatePayment = async function (args, options = defaultOptions, token) {
    try {
      const chainOptions = { ...options, chainIds: [contract.chainId] };
      return managers.paymentManager.updatePayment(args, chainOptions)
    } catch (error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while updating payment status", { message: "Error while updating payment status" })
    }
  };

  contract.getPayment = async function (args, options = defaultOptions) {
    try {
      return managers.paymentManager.get(args, { ...options, org: managers.cirrusOrg, app: contractName });
    } catch (error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while fetching payment", { message: "Error while fetching payment" })
    }
  };

  contract.getPaymentSession = async function (args, options = defaultOptions) {
    try {
      const newOptions = { ...options, org: managers.cirrusOrg, app: contractName }
      const { session_id } = args
      const paymentDetail = await managers.paymentManager.get({ paymentSessionId: session_id }, newOptions);
      const paymentSession = await StripeService.getPaymentSession(session_id, paymentDetail.sellerAccountId);
      const paymentIntent = await StripeService.getPaymentIntent(paymentSession.payment_intent, paymentDetail.sellerAccountId);
      const paymentMethod = await StripeService.getPaymentMethod(paymentIntent.payment_method, paymentDetail.sellerAccountId);
      return { ...paymentSession, payment_method: paymentMethod.card.brand }
    } catch (error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while fetching payment session", { message: "Error while fetching payment" })
    }
  };

  contract.createUserAddress = async function (args, options = defaultOptions) {
    try {
      const createdDate = Math.floor(Date.now() / 1000);
      return managers.paymentManager.createUserAddress({ ...args, createdDate: createdDate, });
    } catch (err) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, `Error while adding address: ${JSON.stringify(err)} `);
    }
  };

  contract.getAllUserAddress = async function (args, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName }
    return userAddressJs.getAll(rawAdmin, { ownerOrganization: userOrganization, ...args }, getOptions);
  };

  return contract;
};

/**
 * Add a new organization to a tCommerce contract/chain.
 * @param {string} orgName The new organization to add
 */
async function addOrg(user, contract, options, orgName) {
  const callArgs = { contract, method: "addOrg", args: util.usc({ orgName }), };
  return rest.call(user, callArgs, options);
}

/**
 * Add a new organization unit to a tCommerce contract/chain.
 * @param {string} orgName The organization the unit to add belongs to
 * @param {string} orgUnit The new organization unit to add
 */
async function addOrgUnit(user, contract, options, orgName, orgUnit) {
  const callArgs = { contract, method: "addOrgUnit", args: util.usc({ orgName, orgUnit }), };
  return rest.call(user, callArgs, options);
}

/**
 * Add a new member to a tCommerce contract/chain.
 * @param {string} orgName The organization the member to add belongs to
 * @param {string} orgUnit The organization unit the member to add belongs to
 * @param {string} commonName The common name of the member to add
 */
async function addMember(user, contract, options, orgName, orgUnit, commonName) {
  const callArgs = { contract, method: "addMember", args: util.usc({ orgName, orgUnit, commonName }), };
  return rest.call(user, callArgs, options);
}

/**
 * Remove an existing organization from a tCommerce contract/chain.
 * @param {string} orgName The organization to remove
 */
async function removeOrg(user, contract, options, orgName) {
  const callArgs = { contract, method: "removeOrg", args: util.usc({ orgName }), };
  return rest.call(user, callArgs, options);
}

/**
 * Remove an existing organization unit from a tCommerce contract/chain.
 * @param {string} orgName The organization the unit to remove belongs to
 * @param {string} orgUnit The organization unit to remove
 */
async function removeOrgUnit(user, contract, options, orgName, orgUnit) {
  const callArgs = { contract, method: "removeOrgUnit", args: util.usc({ orgName, orgUnit }), };
  return rest.call(user, callArgs, options);
}

/**
 * Remove an existing member from a tCommerce contract/chain.
 * @param {string} orgName The organization the member to remove belongs to
 * @param {string} orgUnit The organization unit the member to remove belongs to
 * @param {string} commonName The common name of the member to remove
 */
async function removeMember(user, contract, options, orgName, orgUnit, commonName) {
  const callArgs = { contract, method: "removeMember", args: util.usc({ orgName, orgUnit, commonName }), };
  return rest.call(user, callArgs, options);
}

/**
 * Add multiple new organizations to a tCommerce contract/chain.
 * @param {string} orgNames An array of new organizations to add
 */
async function addOrgs(user, contract, options, orgNames) {
  const callArgs = { contract, method: "addOrgs", args: util.usc({ orgNames }), };
  return rest.call(user, callArgs, options);
}

/**
 * Add multiple new organization units to a tCommerce contract/chain.
 * @param {string} orgNames An array of organizations the units to add belongs to
 * @param {string} orgUnits An array of new organization units to add
 */
async function addOrgUnits(user, contract, options, orgNames, orgUnits) {
  const callArgs = { contract, method: "addOrgUnits", args: util.usc({ orgNames, orgUnits }), };
  return rest.call(user, callArgs, options);
}

/**
 * Add multiple new members to a tCommerce contract/chain.
 * @param {string} orgNames An array of organizations the units to add belongs to
 * @param {string} orgUnits An array of organization units the members to add belongs to
 * @param {string} commonNames An array of the common names of the members to add
 */
async function addMembers(user, contract, options, orgNames, orgUnits, commonNames) {
  const callArgs = { contract, method: "addMembers", args: util.usc({ orgNames, orgUnits, commonNames }), };
  return rest.call(user, callArgs, options);
}

/**
 * Remove multiple existing organizations from a tCommerce contract/chain.
 * @param {string} orgNames An array of organizations to remove
 */
async function removeOrgs(user, contract, options, orgNames) {
  const callArgs = { contract, method: "removeOrgs", args: util.usc({ orgNames }), };
  return rest.call(user, callArgs, options);
}

/**
 * Remove multiple existing organization units from a tCommerce contract/chain.
 * @param {string} orgNames An array of organizations the units to remove belongs to
 * @param {string} orgUnits An array of organization units to remove
 */
async function removeOrgUnits(user, contract, options, orgNames, orgUnits) {
  const callArgs = { contract, method: "removeOrgUnits", args: util.usc({ orgNames, orgUnits }), };
  return rest.call(user, callArgs, options);
}

/**
 * Remove multiple existing members from a tCommerce contract/chain.
 * @param {string} orgNames An array of organizations the units to remove belongs to
 * @param {string} orgUnits An array of organization units the members to remove belongs to
 * @param {string} commonNames An array of the common names of the members to remove
 */
async function removeMembers(user, contract, options, orgNames, orgUnits, commonNames) {
  const callArgs = { contract, method: "removeMembers", args: util.usc({ orgNames, orgUnits, commonNames }), };
  return rest.call(user, callArgs, options);
}

async function getChainById(user, chainId) {
  const chainInfo = await rest.getChain(user, chainId, options);
  return chainInfo;
}

async function getChains(user, chainIds = []) {
  const keyResponse = await rest.getKey(user, defaultOptions);
  let chains;

  try {
    chains = await rest.getChains(user, chainIds, defaultOptions);
  } catch (e) {
    if (e.response.status === 500) {
      chains = [];
    }
    console.error("Error getting chainInfo:", e);
  }

  const filtered = chains.reduce((acc, c) => {
    const member = c.info.members.find((m) => { return m.address === keyResponse; });
    if (member !== undefined) {
      acc.push(c);
    }
    return acc;
  }, []);

  return filtered;
}

function bindAddress(user, address, options) {
  const contract = {
    name: contractName,
    address,
  };
  return bind(user, contract, options);
}

export default {
  bind,
  loadFromDeployment,
  uploadContract,
  bindAddress,
  contractName,
  uploadDappContract
};
