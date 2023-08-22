import { rest, util, importer } from "blockapps-rest";
const { createContract } = rest;
import constants, { CHARGES, ORDER_STATUS, SERVICE_PROVIDERS } from "/helpers/constants";
import { yamlWrite, yamlSafeDumpSync, getYamlFile } from "/helpers/config";
import { pollingHelper } from "/helpers/utils";

import StripeService from "/payment-service/stripe.service";
import dayjs from 'dayjs';
import RestStatus from 'http-status-codes';
import certificateJs from "/dapp/certificates/certificate";

import orderJs from "/dapp/orders/order";

import eventTypeJs from "/dapp/eventType/eventType";
import eventTypeManagerJs from "/dapp/eventType/eventTypeManager";
import productManagerJs from "/dapp/products/productManager";
import marketplaceJs from "/dapp/marketplace/marketplace.js";
import userAddressJs from "/dapp/addresses/userAddress.js";
import paymentManagerJs from "/dapp/payments/paymentManager";
import paymentProviderJs from '/dapp/payments/paymentProvider';
import orderManagerJs from '/dapp/orders/orderManager';

const allAssetNames = [
  orderJs.contractName,
  eventTypeJs.contractName,
  eventTypeManagerJs.contractName,
];

const contractName = "Dapp";
const contractFileName = `dapp/dapp/contracts/Dapp.sol`;

const balance = 100000000000000000000;
let   userCert = null;

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
  const productManager = await productManagerJs.bindAddress(admin, state["productManager"], options);
  const eventTypeManager = await eventTypeManagerJs.bindAddress(admin, state.eventTypeManager, options);
  const paymentManager = await paymentManagerJs.bindAddress(admin, state.paymentManager, options)
  const orderManager = await orderManagerJs.bindAddress(admin, state.orderManager, options)

  const cirrusOrg = state.bootUserOrganization !== "" ? state.bootUserOrganization : undefined;

  return { cirrusOrg, productManager, eventTypeManager, paymentManager, orderManager };
}

async function bind(rawAdmin, _contract, _defaultOptions, serviceUser = false) {
  const contract = _contract;
  console.log(contract)
  let userOrganization

  if (!serviceUser) {
    
    let userCertificate = await pollingHelper(certificateJs.getCertificateMe, [rawAdmin]);

    //We are not guaranteed the user will have a certificate
    //99% chance they do, but if this this their first login
    //the node might not have a certificate in time
    if (!(userCertificate === null || userCertificate === undefined || userCertificate.organization === null || userCertificate.organization === undefined)) {
      contract.userOrganization = userCertificate.organization
      userOrganization = userCertificate.organization
      userCert    = userCertificate;//Attaching user cert to dapp to save from needing make another call to get it
      console.log('dapp - userCertificate.organization', userCertificate.organization)
    }
  }

  const managers = await getManagersAndCirrusInfo(rawAdmin, contract, _defaultOptions)
  // includes the org+app for cirrus namespacing (helpers/utils.js will prepend to cirrus queries)
  const defaultOptions = { ..._defaultOptions, org: managers.cirrusOrg, app: contractName, chainIds: [], };
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

  // --------------------------------- ASSETS ---------------------------------
  // ------------------------------ PRODUCT MANAGER --------------------------------
  contract.createProduct = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    const newArgs = { uniqueProductCode: parseInt(util.iuid()), ...args.productArgs };
    return managers.productManager.createProduct({ ...newArgs, createdDate: createdDate });
  };
  contract.updateProduct = async function (args, options = defaultOptions) {
    return managers.productManager.updateProduct(args);
  };
  contract.deleteProduct = async function (args, options = defaultOptions) {
    return managers.productManager.deleteProduct(args);
  };
  contract.createInventory = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    const { ...restArgs } = args;
    const newArgs = { ...restArgs, batchSerializationNumber: util.uid() }
    const quantity = args.quantity;
    const serialNumbers = []

    const [createInventoryStatus, createdInventoryAddress] = await managers.productManager.createInventory({ ...newArgs, createdDate, serialNumbers });

    return [
      createInventoryStatus,
      createdInventoryAddress,
    ];

  };

  contract.resellInventory = async function (args, options = defaultOptions) {
    const { inventoryId, quantity, price, ...newArgs } = args;
    return await managers.productManager.resellInventory({ existingInventory: inventoryId, quantity, price });
  };

  contract.updateInventory = async function (args, options = defaultOptions) {
    return await managers.productManager.updateInventory(args);
  };
  contract.getProduct = async function (args, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
    return managers.productManager.getProduct({ ...args, ownerOrganization: userOrganization }, getOptions);
  };
  contract.getProducts = async function (args, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName };
    console.log('dapp.getProducts - userOrganization', userOrganization)
    return managers.productManager.getProducts(
      { ...args, sort: '-createdDate', ownerOrganization: userOrganization },
      getOptions
    );
  };
  contract.getProductNames = async function (args, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
    return managers.productManager.getProducts(
      { ...args, sort: '-createdDate' },
      getOptions
    );
  };
  contract.getInventory = async function (args, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
    return managers.productManager.getInventory({ ...args, ownerOrganization: userOrganization }, getOptions);
  };
  contract.getInventories = async function (args, options = optionsNoChainIds) {
    const { userAddress, ...restArgs } = args
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
    return managers.productManager.getInventories({ ...restArgs, sort: '-createdDate', ownerOrganization: userOrganization }, getOptions);
  };

  contract.getCarbon = async function (args, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
    const carbon = await managers.productManager.getCarbon({ ...args }, getOptions);

    const productData = await managers.productManager.getProduct({
      address: carbon.productId,
      ownerOrganization: userOrganization
    }, getOptions);

    const carbonData = { ...carbon, ...productData }
    return carbonData;
  };

  contract.getCarbons = async function (args, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName };
    const allCarbonsData = await managers.productManager.getCarbons({ ...args }, getOptions);
    const carbonsWithProducts = [];

    for (const carbon of allCarbonsData) {
      const productData = await managers.productManager.getProduct({
        ...args,
        offset: 0,
        sort: null,
        address: carbon.productId,
        ownerOrganization: userOrganization
      }, getOptions);
      carbonsWithProducts.push({ ...carbon, ...productData })
    }
    
    return carbonsWithProducts;
  };

  contract.createCarbon = async function (args, options = optionsNoChainIds) {
    const createdDate = Math.floor(Date.now() / 1000);
    const productArgs = { uniqueProductCode: parseInt(util.iuid()), ...args.productArgs };

    const [createProductStatus, createdProductAddress] = await managers.productManager.createProduct({ ...productArgs, createdDate: createdDate });

    if (createProductStatus == 200) {
      const carbonArgs = {
        productId: createdProductAddress,
        projectType: args.projectType,
        methodology: args.methodology,
        projectCountry: args.projectCountry,
        projectCategory: args.projectCategory,
        projectDeveloper: args.projectDeveloper,
        dMRV: args.dMRV,
        registry: args.registry,
        creditType: args.creditType,
        sdg: args.sdg,
        validator: args.validator,
        eligibility: args.eligibility,
        permanenceType: args.permanenceType,
        reductionType: args.reductionType,
        unit: args.unit,
        currency: args.currency,
        divisibility: args.divisibility
      }

      return managers.productManager.createCarbon(carbonArgs);
    }
  }
  // ------------------------------ PRODUCT MANAGER ENDS--------------------------------

  contract.getMarketplaceInventories = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName };
    return marketplaceJs.getAll(rawAdmin, { ...args }, getOptions);
  };

  contract.getMarketplaceInventoriesLoggedIn = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName };
    return marketplaceJs.getAll(rawAdmin, { ...args, notEqualsField: 'ownerOrganization', notEqualsValue: userOrganization }, getOptions);
  };

  contract.getTopSellingProducts = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName }
    // The issue with this is coming from the notEqualsValue. ServiceTokenUser gives BlockApps which returns nothing. Blockapps lowercase is needed to make the request work. 
    return marketplaceJs.getTopSellingProducts(rawAdmin, { ...args }, getOptions)
  }

  contract.getTopSellingProductsLoggedIn = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName }
    return marketplaceJs.getTopSellingProducts(rawAdmin, { ...args, notEqualsField: 'ownerOrganization', notEqualsValue: userOrganization }, getOptions)
  }

  contract.retireCredits = async function (args, options = defaultOptions) {
    return managers.productManager.retireCredits(args, rawAdmin, contract, options);
  }

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
  //-----------------------------Order starts here -------------------------------

  //TODO implement payment contract creation inside dapp and use payment services there
  contract.paymentCheckout = async function (args, options = defaultOptions) {
    try {

      const { buyerOrganization, orderList, orderTotal: recievedOrderTotal } = args;

      const newOptions = { ...options, org: managers.cirrusOrg, app: contractName }
      // TODO

      const inventoriesAddresses = orderList.map(order => order.inventoryId);
      const inventoriesList = await managers.productManager.getInventories({ address: inventoriesAddresses }, newOptions);

      if (inventoriesList.length == 0 || inventoriesList.length != orderList.length) {
        throw new rest.RestError(RestStatus.NOT_FOUND, "Inventory not found")
      }

      const inventoryOrganization = inventoriesList[0].ownerOrganization;
      for (const curr_inventory of inventoriesList) {

        if (curr_inventory.ownerOrganization == userOrganization) {
          throw new rest.RestError(RestStatus.BAD_REQUEST, "Seller cannot buy his own product",);
        }

        /* User shouldn't be allowed buy products from multiple sellers  */
        if (inventoryOrganization != curr_inventory.ownerOrganization) {
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

      const productAddresses = inventoriesList.map(d => d.productId)
      const productList = await managers.productManager.getProducts({ address: productAddresses }, newOptions);

      const invoices = []; let calculatedOrderTotal = 0

      orderList.forEach(orderLine => {
        const inventoryItem = inventoriesList.find(inven => inven.address == orderLine.inventoryId)
        const product = productList.find(item => item.address === inventoryItem.productId)
        invoices.push({ productName: decodeURIComponent(product.name), unitPrice: inventoryItem.pricePerUnit, quantity: orderLine.quantity })

        calculatedOrderTotal += (inventoryItem.pricePerUnit * orderLine.quantity)
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
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while updating  the Order");
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
      return StripeService.getPaymentSession(session_id, paymentDetail.sellerAccountId);
    } catch (error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while fetching payment session", { message: "Error while fetching payment" })
    }
  };

  contract.createOrder = async function (args, options = defaultOptions) {
    try {
      const { buyerOrganization, orderList, orderTotal: recievedOrderTotal, paymentSessionId = "", shippingAddress } = args;
      const currentTimestamp = Math.floor(Date.now() / 1000);

      const [createdDate, orderDate] = Array(2).fill(currentTimestamp);

      const createOptions = { ...optionsNoChainIds, org: managers.cirrusOrg }
      const orderOptions = { ..._defaultOptions, org: managers.cirrusOrg }

      if (paymentSessionId.length > 1) {
        const order = await managers.orderManager.getOrders(rawAdmin, { paymentSessionId }, createOptions);
        if (order.length > 0) {
          throw new rest.RestError(RestStatus.BAD_REQUEST, `Order already placed for payment_id ${paymentSessionId}`)
        }
      }

      // get inventories data
      const inventoryIdArray = orderList.map(order => order.inventoryId);
      const inventories = await managers.productManager.getInventories(
        { address: [...inventoryIdArray] },
        createOptions
      );

      if (!Array.isArray(inventories)) {
        throw new rest.RestError(RestStatus.NOT_FOUND, "Inventory not found")
      }

      const quantitiesToReduce = orderList.map(order => order.quantity);

      // reducing quantity inside inventories to place order and checking the buyerOrganization should not be equal to inventory organization
      inventories.forEach(inventory => {
        if (buyerOrganization == inventory.ownerOrganization) {
          throw new rest.RestError(RestStatus.BAD_REQUEST, "Seller can not buy his own product");
        }
        const orderItem = orderList.find(item => item.inventoryId === inventory.address);
        if (orderItem) {
          inventory.quantity = orderItem.quantity;
        }

      });

      const groupedData = inventories.reduce((acc, inventory) => {
        if (!acc[inventory.ownerOrganization]) {
          acc[inventory.ownerOrganization] = { ownerOrganization: inventory.ownerOrganization, data: [] };
        }
        acc[inventory.ownerOrganization].data.push(inventory);
        return acc;
      }, {});

      const inventoriesData = Object.values(groupedData);
      const total = inventoriesData.reduce((acc, obj) => {
        const result = obj.data.reduce((total, curr) => total + curr.pricePerUnit * curr.quantity, 0);
        return acc + result;
      }, 0);

      if (total != recievedOrderTotal) {
        throw new rest.RestError(RestStatus.BAD_REQUEST, "Order Total is not matching");
      }

      let orders = [];
      for (const inventory of inventoriesData) {
        const inventoryTotal = inventory.data.reduce((acc, curr) => acc + (curr.pricePerUnit * curr.quantity), 0);
        const shippingCharge = inventoryTotal * CHARGES.SHIPPING;
        const tax = inventoryTotal * CHARGES.TAX;

        // shipping charge for order 
        const orderTotal = inventoryTotal + shippingCharge + tax;
        const amountPaid = orderTotal;  // need to remove if no further use

        const orderArgs = {
          orderId: util.uid(),
          buyerOrganization,
          sellerOrganization: inventory.ownerOrganization,
          orderDate,
          orderTotal,
          orderShippingCharges: shippingCharge,
          status: ORDER_STATUS.AWAITING_FULFILLMENT,
          amountPaid,
          createdDate, paymentSessionId, shippingAddress
        }

        const [statusCode, orderAddress] = await managers.orderManager.createOrder(orderArgs);
        orders.push([statusCode, orderAddress]);

        // add orderLine for inventories
        for (const inventoryObject of inventory.data) {
          const tax = (inventoryObject.pricePerUnit * inventoryObject.quantity) * CHARGES.SHIPPING;

          await managers.orderManager.addOrderLine({
            orderAddress,
            productId: inventoryObject.productId,
            inventoryId: inventoryObject.address,
            batchSerializationNumber: inventoryObject.batchSerializationNumber,
            quantity: inventoryObject.quantity,
            pricePerUnit: inventoryObject.pricePerUnit,
            tax,
            createdDate
          });
        };
      }
      await managers.productManager.updateInventoriesQuantities({ inventories: inventoryIdArray, quantities: quantitiesToReduce, isReduce: true })
      return orders;
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while creating the order");
    }
  }

  contract.updateBuyerDetails = async function (args, options = defaultOptions) {
    try {
      const { address, updates } = args;

      if (updates.status == ORDER_STATUS.CANCELED) {
        const [inventoryAddresses, quantitiesToUpdate] =
          await managers.orderManager.updateBuyerDetails({ orderAddress: address, ...updates });

        const inventories = inventoryAddresses.split(",").slice(0, -1);
        const quantities = quantitiesToUpdate.split(",").slice(0, -1);
        const [status] = await managers.productManager.updateInventoriesQuantities({ inventories, quantities, isReduce: false, });

        return { status };
      }

      return managers.orderManager.updateBuyerDetails({ orderAddress: address, updates });
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while updating  the Order");
    }
  };

  contract.updateSellerDetails = async function (args, options = defaultOptions) {
    try {
      const { address, chainId, updates } = args;
      const contract = { name: orderJs.contractName, address: address, };

      const createOptions = { ...options, org: managers.cirrusOrg, app: contractName };
      if (updates.status == ORDER_STATUS.CANCELED) {
        const [statusResponse, inventoryAddresses, quantitiesToUpdate] =
          await managers.orderManager.updateSellerDetails({ orderAddress: address, ...updates });

        const inventories = inventoryAddresses.split(",").slice(0, -1);
        const quantities = quantitiesToUpdate.split(",").slice(0, -1);
        const [status] = await managers.productManager.updateInventoriesQuantities({ inventories, quantities, isReduce: false, });

        return { status };
      } else if (updates.status == ORDER_STATUS.CLOSED) {
        const [statusResponse, inventoryAddresses, quantitiesToUpdate] = await managers.orderManager.updateSellerDetails({ orderAddress: address, ...updates });

        const orderLines = await managers.orderManager.getOrderLines({ orderAddress: address }, createOptions);

        let newOwner = orderLines[0].owner
        let result = []

        for (let orderLine of orderLines) {
          const orderLineProductId = orderLine.productId;
          const orderLineInventoryId = orderLine.inventoryId;
          const [status, productId, inventoryId] = await managers.productManager.sellItems({ productId: orderLineProductId, inventoryId: orderLineInventoryId, newOwner, newQuantity: orderLine.quantity });
          result.push({ status, productId, inventoryId });
        }
        return result;
      }

      return managers.orderManager.updateSellerDetails({ orderAddress: address, ...updates });
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while updating  the Order");
    }
  };

  contract.getOrder = async function (args, options = optionsNoChainIds) {
    try {

      const { address, ...newArgs } = args;

      const createOptions = { ...options, org: managers.cirrusOrg, app: contractName };
      const optionsWithChainId = { ...options, org: managers.cirrusOrg };

      const order = managers.orderManager.getOrder(args, createOptions);
      const orderLines = managers.orderManager.getOrderLines({ orderAddress: address }, createOptions);

      const response = await Promise.allSettled([order, orderLines]);
      const userContactAddress = await userAddressJs.get(rawAdmin, { address: response[0].value.shippingAddress }, createOptions)
      const result = { userContactAddress, ...response[0].value, orderLines: response[1].value, };

      const productIds = [
        ...new Set(result.orderLines.map((orderLines) => orderLines.productId)),
      ];
      const { chainIds, ...newOptions } = options;

      const products = await managers.productManager.getProducts({ address: [...productIds], chainId: contract.chainId }, createOptions);

      if (!products || products.length === 0) {
        throw new rest.RestError(RestStatus.NOT_FOUND, "Products not found");
      }

      result.orderLines.forEach((orderLine) => {
        const product = products.find(
          (product) => product.address === orderLine.productId
        );
        if (product) {
          orderLine.productName = product.name;
          orderLine.imageKey = product.imageKey;
          orderLine.amount = orderLine.pricePerUnit * orderLine.quantity + orderLine.shippingCharges + orderLine.tax;
        }
      });

      return result;
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while Fetching  the Order");
    }
  };

  contract.getOrders = async function (args = {}, options = optionsNoChainIds) {
    try {
      const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
      return managers.orderManager.getOrders(rawAdmin, args, getOptions);
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while Fetching  the Orders");
    }
  };

  // TODO : add error handling 
  contract.transferOwnershipOrder = async function (args, options = defaultOptions) {
    const { address, chainId, newOwner } = args;
    const contract = { name: orderJs.contractName, address: address, };
    const chainOptions = { chainIds: [chainId], ...options };
    return orderJs.transferOwnership(rawAdmin, contract, chainOptions, newOwner);
  };

  contract.getOrderLine = async function (args = {}, options = optionsNoChainIds) {
    try {

      const { address } = args;
      const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
      const orderLine = await managers.orderManager.getOrderLine({ ...args, }, getOptions);

      const inventory = await contract.getInventory({ address: orderLine.inventoryId, });

      return { ...inventory, items: [], };
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while Fetching  the OrderLine");
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


  //-----------------------------Order ends here -------------------------------
  contract.createEventType = async function (args, options = defaultOptions) {
    try {

      const createdDate = Math.floor(Date.now() / 1000);
      return managers.eventTypeManager.createEventType({ ...args, createdDate, });
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while creating Event Type");
    }
  };

  contract.getEventTypes = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
    return managers.eventTypeManager.getAll({ ...args, ownerOrganization: userOrganization }, getOptions);
  };

  contract.transferOwnershipEvent = async function (args, options = defaultOptions) {
    const { address, chainId, newOwner } = args;

    const contract = { name: eventJs.contractName, address: address, };
    const chainOptions = { chainIds: [chainId], ...options };
    return eventJs.transferOwnership(rawAdmin, contract, chainOptions, newOwner);
  };

  contract.auditEvent = async function (args, options = defaultOptions) {
    const { address, chainId } = args;
    const auditOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
    return eventJs.getHistory(rawAdmin, chainId, address, auditOptions);
  };

  return contract;
}


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
