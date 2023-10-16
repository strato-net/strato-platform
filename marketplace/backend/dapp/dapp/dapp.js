import { rest, util, importer } from "blockapps-rest";
const { createContract } = rest;
import constants, { CHARGES, ITEM_STATUS, ORDER_STATUS, SERVICE_PROVIDERS } from "/helpers/constants";
import { yamlWrite, yamlSafeDumpSync, getYamlFile } from "/helpers/config";
import { pollingHelper } from "/helpers/utils";

import StripeService from "/payment-service/stripe.service";
import dayjs from 'dayjs';
import RestStatus from 'http-status-codes';
import certificateJs from "/dapp/certificates/certificate";

import itemJs from "/dapp/items/item";
import orderJs from "/dapp/orders/order";
import orderLineJs from "/dapp/orders/orderLine";

import eventTypeJs from "/dapp/eventType/eventType";
import eventTypeManagerJs from "/dapp/eventType/eventTypeManager";
import serviceJs from "dapp/service/service";
import serviceManagerJS from "/dapp/service/serviceManager";
import productFileJs from "/dapp/productFile/productFile";
import serviceUsageJs from "/dapp/serviceUsage/serviceUsage";
import itemManagerJs from "/dapp/items/itemManager";
import productManagerJs from "/dapp/products/productManager";
import marketplaceJs from "/dapp/marketplace/marketplace.js";
import userAddressJs from "/dapp/addresses/userAddress.js";
import paymentManagerJs from "/dapp/payments/paymentManager";
import paymentProviderJs from '/dapp/payments/paymentProvider';
import orderManagerJs from '/dapp/orders/orderManager';
import membershipJs from "../membership/membership";
import membershipServiceJs from "../membershipService/membershipService";
import membershipManagerJs from "../membership/membershipManager";

const allAssetNames = [
  orderJs.contractName,
  // orderLineItemJs.contractName,
  eventTypeJs.contractName,
  eventTypeManagerJs.contractName,
  serviceJs.contractName,
  serviceManagerJS.contractName,
  productFileJs.contractName,
  serviceUsageJs.contractName,
  membershipJs.contractName,
  membershipServiceJs.contractName,
  membershipManagerJs.contractName,
];

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
  const itemManager = await itemManagerJs.bindAddress(admin, state["itemManager"], options);
  const productManager = await productManagerJs.bindAddress(admin, state["productManager"], options);
  const eventTypeManager = await eventTypeManagerJs.bindAddress(admin, state.eventTypeManager, options);
  const serviceManager = await serviceManagerJS.bindAddress(admin, state.serviceManager, options)
  const paymentManager = await paymentManagerJs.bindAddress(admin, state.paymentManager, options)
  const orderManager = await orderManagerJs.bindAddress(admin, state.orderManager, options)
  const membershipManager = await membershipManagerJs.bindAddress(admin, state.membershipManager, options)

  const cirrusOrg = state.bootUserOrganization !== "" ? state.bootUserOrganization : undefined;

  return { cirrusOrg, productManager, eventTypeManager, serviceManager, itemManager, paymentManager, orderManager, membershipManager };
}

async function bind(rawAdmin, _contract, _defaultOptions, serviceUser = false) {
  const contract = _contract;
  console.log(contract)
  let userOrganization
  let userAddress

  if (!serviceUser) {

    let userCertificate = await pollingHelper(certificateJs.getCertificateMe, [rawAdmin]);

    //We are not guaranteed the user will have a certificate
    //99% chance they do, but if this this their first login
    //the node might not have a certificate in time
    if (!(userCertificate === null || userCertificate === undefined || userCertificate.organization === null || userCertificate.organization === undefined)) {
      contract.userOrganization = userCertificate.organization
      userOrganization = userCertificate.organization
      userAddress = userCertificate.userAddress
      userCert = userCertificate;//Attaching user cert to dapp to save from needing make another call to get it
      console.log('dapp - userCertificate.organization', userCertificate)
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

  // ------------------------------ ITEMS --------------------------------
  contract.addItem = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    return managers.itemManager.addItem({ ...args.itemArgs, createdDate: createdDate, });
  };
  contract.updateItem = async function (args, options = defaultOptions) {
    return managers.itemManager.updateItem(args);
  };
  contract.getItems = async function (args = {}, options = defaultOptions) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
    return managers.itemManager.getItems({ ...args }, getOptions);
  };

  // ------------------------------ EVENTS --------------------------------
  contract.createEvent = async function (args, options = optionsNoChainIds) {
    try {

      const { productId, serialNumbers } = args;
      const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };

      const eventBatchId = util.uid();
      const createdDate = Math.floor(Date.now() / 1000);

      const serialNosBatch = 200
      const itemsAddressArr = []

      for (let i = 0; i < serialNumbers.length; i += serialNosBatch) {
        const serialNumberArr = serialNumbers.slice(i, i + serialNosBatch);

        const items = await managers.itemManager.getItems({ productId: productId, serialNumber: serialNumberArr }, getOptions)

        if (items.length != serialNumberArr.length) {
          throw new rest.RestError(RestStatus.CONFLICT,
            "Invalid serial numbers for product")
        }
        items.forEach(item => itemsAddressArr.push(item.address))
      }

      if (!args.certifier) args.certifier = constants.zeroAddress
      return managers.itemManager.addEvent({ itemsAddress: itemsAddressArr, ...args, eventBatchId: eventBatchId, createdDate: createdDate, });
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while Creating event");
    }
  };

  // TODO:getEvents need to be revisited for performance related issues.
  contract.getEvents = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = {
      ...options,
      org: managers.cirrusOrg,
      app: contractName,
    };

    const { filterByCertifier, ...restArgs } = args
    if (filterByCertifier) {
      restArgs.certifier = rawAdmin.address;
    }

    const events = await managers.itemManager.getEvents({

      ...restArgs,
      limit: 3000,
    }, getOptions);

    const eventTypeIdSet = new Set()
    const groupByEventBatchId = events.reduce((group, event) => {
      const { eventBatchId } = event;
      if (!group[eventBatchId]) {
        group[eventBatchId] = {
          eventTypeId: event.eventTypeId,
          eventBatchId: event.eventBatchId,
          summary: event.summary,
          date: event.date,
          certifier: event.certifier,
          certifiedDate: event.certifiedDate,
          certifierComment: event.certifierComment,
          serialNo: [event.itemSerialNumber]
        };
      } else {
        group[eventBatchId].serialNo.push(event.itemSerialNumber)
      }
      if (!eventTypeIdSet.has(event.eventTypeId)) {
        eventTypeIdSet.add(event.eventTypeId)
      }
      return group;
    }, {});

    const eventTypes = await managers.eventTypeManager.getAll({

      address: [...eventTypeIdSet],
    }, getOptions);

    const response = []
    for (const key in groupByEventBatchId) {
      if (Object.hasOwnProperty.call(groupByEventBatchId, key)) {
        const element = groupByEventBatchId[key];
        const eventTypeId = element.eventTypeId
        const eventTypesData = eventTypes.find(eventType => eventType.address == eventTypeId);
        element.eventTypename = eventTypesData.name
        element.eventTypeDescription = eventTypesData.description
        response.push(element)
      }
    }

    const certifiers = response.map(({ certifier }) => certifier);
    const users = await certificateJs.getCertificates(admin, { userAddress: certifiers });

    const certifierUsersObj = users.reduce((acc, { commonName, userAddress }) => {
      acc[userAddress] = { commonName, userAddress };
      return acc;
    }, {});

    const updatedResponse = response.map(cert => {
      const certifierUser = certifierUsersObj[cert.certifier];
      if (certifierUser) cert.certifierName = certifierUser.commonName;
      return cert;
    });

    return updatedResponse;
  };


  contract.getInventoryEventTypes = async function (args = {}, options = optionsNoChainIds) {
    const { inventoryId } = args;
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };

    const items = await managers.itemManager.getItems({ inventoryId }, getOptions);

    const itemsAddress = items.map((item) => item.address);
    const events = await managers.itemManager.getEvents({ limit: 3000, itemAddress: [...itemsAddress] }, getOptions);

    const eventTypeIdSet = new Set()
    events.forEach((event) => {
      if (!eventTypeIdSet.has(event.eventTypeId)) {
        eventTypeIdSet.add(event.eventTypeId)
      }
    });

    const eventTypes = await managers.eventTypeManager.getAll({

      address: [...eventTypeIdSet]
    }, getOptions);

    const response = eventTypes.map((eventType) => {
      return {
        eventTypeName: eventType.name,
        eventTypeDescription: eventType.description,
        eventTypeId: eventType.address
      }
    })

    return response
  };

  contract.getInventoryEventTypeDetails = async function (args = {}, options = optionsNoChainIds) {
    const { inventoryId, eventTypeId } = args;

    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
    const items = await managers.itemManager.getItems({ inventoryId }, getOptions);

    const itemsAddress = items.map((item) => item.address);
    const events = await managers.itemManager.getEvents({ limit: 3000, eventTypeId, itemAddress: [...itemsAddress] }, getOptions);

    const groupByEventBatchId = events.reduce((group, event) => {
      const { eventBatchId } = event;
      if (!group[eventBatchId]) {
        group[eventBatchId] = {
          eventTypeId: event.eventTypeId,
          eventBatchId: event.eventBatchId,
          summary: event.summary,
          date: event.date,
          certifier: event.certifier,
          certifiedDate: event.certifiedDate,
          certifierComment: event.certifierComment,
          serialNo: [event.itemSerialNumber]
        };
      } else {
        group[eventBatchId].serialNo.push(event.itemSerialNumber)
      }
      return group;
    }, {});

    const eventType = await managers.eventTypeManager.get({

      address: eventTypeId
    }, getOptions);

    const eventsData = []
    for (const key in groupByEventBatchId) {
      if (Object.hasOwnProperty.call(groupByEventBatchId, key)) {
        const element = groupByEventBatchId[key];
        eventsData.push(element)
      }
    }

    const certifiers = eventsData.map(({ certifier }) => certifier);
    const users = await certificateJs.getCertificates(admin, { userAddress: certifiers });

    const certifierUsersObj = users.reduce((acc, { commonName, userAddress }) => {
      acc[userAddress] = { commonName, userAddress };
      return acc;
    }, {});

    const updatedEventsData = eventsData.map(cert => {
      const certifierUser = certifierUsersObj[cert.certifier];
      if (certifierUser) cert.certifierName = certifierUser.commonName;
      return cert;
    });

    const response = {
      eventTypeName: eventType.name,
      eventTypeDescription: eventType.description,
      events: updatedEventsData
    }

    return response;
  };


  // --------------------------------- ASSETS ---------------------------------
  // ------------------------------ PRODUCT MANAGER --------------------------------
  contract.createProduct = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    const newArgs = { uniqueProductCode: parseInt(util.iuid()), ...args.productArgs }
    return managers.productManager.createProduct({ ...newArgs, createdDate: createdDate });
  };
  contract.updateProduct = async function (args, options = defaultOptions) {
    return managers.productManager.updateProduct(args);
  };
  contract.deleteProduct = async function (args, options = defaultOptions) {
    return managers.productManager.deleteProduct(args);
  };
  contract.createInventory = async function (args, options = defaultOptions) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
    const createdDate = Math.floor(Date.now() / 1000);
    const { serialNumber, ...restArgs } = args;

    const serialNo = [];
    const repeatedSerialNumber = [];
    const serialNumbers = []


    if (serialNumber.length !== 0 || serialNumber.length !== undefined) {
      for (let i = 0; i < serialNumber.length; i += 200) {
        serialNo.push(serialNumber[i].itemSerialNumber)
        const serialNumberArr = serialNo.slice(i, i + 200);
        const items = await contract.getItems({ productId: restArgs.productAddress, serialNumber: serialNumberArr });

        items.forEach(obj => {
          const item = serialNumberArr.find(num => num === obj.serialNumber);
          if (item) {
            repeatedSerialNumber.push(item);
          }
        });
      }
    }
    if (repeatedSerialNumber.length != 0) {
      throw new rest.RestError(RestStatus.CONFLICT, { message: "repeated serial numbers found", data: repeatedSerialNumber },);
    }

    const productDetail = await managers.productManager.getProduct({ address: restArgs.productAddress }, getOptions);

    let transformedArray = [];

    if (serialNumber.length !== 0 || serialNumber.length !== undefined) {
      serialNumber.forEach(function (item) {
        let rawMaterialProductNameArray = [];
        let rawMaterialSerialNumberArray = [];
        let rawMaterialProductIdArray = [];

        if (item.rawMaterials.length != 0) {
          item.rawMaterials.forEach(function (rawMaterial) {
            let rawMaterialProductName = rawMaterial.rawMaterialProductName;
            let rawMaterialSerialNumbers = rawMaterial.rawMaterialSerialNumbers;
            let rawMaterialProductId = rawMaterial.rawMaterialProductId;

            for (const element of rawMaterialSerialNumbers) {
              rawMaterialProductNameArray.push(rawMaterialProductName);
              rawMaterialSerialNumberArray.push(element);
              rawMaterialProductIdArray.push(rawMaterialProductId);
            }
          });
        }

        transformedArray.push({
          "itemNumber": parseInt(util.iuid()),
          "serialNumber": item.itemSerialNumber,
          "rawMaterialProductName": rawMaterialProductNameArray,
          "rawMaterialSerialNumber": rawMaterialSerialNumberArray,
          "rawMaterialProductId": rawMaterialProductIdArray
        });
        serialNumbers.push(item.itemSerialNumber)
      });
    }
    // For some reason an else statement is not working here
    if (serialNumber.length === 0 || serialNumber.length === undefined) {
      const quantity = args.quantity;
      for (let i = 0; i < quantity; i++) {
        transformedArray.push({
          "itemNumber": parseInt(util.iuid()),
          "serialNumber": "",
          "rawMaterialProductName": [],
          "rawMaterialSerialNumber": [],
          "rawMaterialProductId": []
        });
      }
    }
    const [createInventoryStatus, createdInventoryAddress] = await managers.productManager.createInventory({ ...restArgs, createdDate, serialNumbers });

    /* hacky hacky hacky - temporary, only way to do it without a contract change */
    if (args.quantity === 0) {
      return [
        createInventoryStatus,
        createdInventoryAddress,
      ]
    }

    const itemParams = {
      itemObject: transformedArray,
      createdDate,
      comment: "",
      productId: restArgs.productAddress,
      status: restArgs.status,
      inventoryId: createdInventoryAddress,

      uniqueProductCode: productDetail.uniqueProductCode
    };
    const [itemStatus, itemAddress, repeatedSerialNumbers] = await managers.itemManager.addItem(itemParams);

    return [
      itemStatus,
      createdInventoryAddress,
      itemAddress.slice(0, -1),
      repeatedSerialNumbers.slice(0, -1),
    ];

  };
  contract.updateInventory = async function (args, options = defaultOptions) {
    const { inventory: inventoryId } = args;
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
    const items = await managers.itemManager.getItems({ inventoryId }, getOptions);
    const itemsAddress = items.map((item) => item.address);
    await managers.productManager.updateInventory(args);
    const itemParams = { itemsAddress, comment: "", status: args.updates.status, };
    return await managers.itemManager.updateItem(itemParams);
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

  contract.getItem = async function (args, options = optionsNoChainIds) {
    return itemJs.get(rawAdmin, args, { ...options, org: managers.cirrusOrg, app: contractName });
  };

  contract.getItems = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
    return itemJs.getAll(rawAdmin, { ...args, }, getOptions);
  };

  contract.getItemOwnershipHistory = function (args, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
    return itemJs.getAllOwnershipEvents(rawAdmin, { ...args, }, getOptions);
  };

  contract.transferOwnershipItem = async function (args, options = defaultOptions) {
    const { address, chainId, newOwner } = args;
    const contract = { name: itemJs.contractName, address: address, };
    const chainOptions = { chainIds: [chainId], ...options };
    return itemJs.transferOwnership(rawAdmin, contract, chainOptions, newOwner);
  };

  contract.auditItem = async function (args, options = defaultOptions) {
    const { address, chainId } = args;
    const auditOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
    return itemJs.getHistory(rawAdmin, chainId, address, auditOptions);
  };

  contract.updateItem = async function (args, options = defaultOptions) {
    const { address, chainId, updates } = args;
    const contract = { name: itemJs.contractName, address: address, };
    const chainOptions = { chainIds: [chainId], ...options };
    return itemJs.update(rawAdmin, contract, updates, chainOptions);
  };

  contract.getRawMaterials = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
    return managers.itemManager.getRawMaterials({

      ...args,
    },
      getOptions
    );
  };

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
      const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
      const { buyerOrganization, orderList, orderTotal: recievedOrderTotal, paymentSessionId = "", shippingAddress } = args;
      const currentTimestamp = Math.floor(Date.now() / 1000);

      const [createdDate, orderDate] = Array(2).fill(currentTimestamp);

      const createOptions = { ...optionsNoChainIds, org: managers.cirrusOrg }

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


      // fetching all product details to create new product to make user its owner.
      // const productdetails = await inventories.map((item) => {
      //   return managers.productManager.getProduct({ address: item.productId }, getOptions);
      // })

      // reducing quantity inside inventories to place order and checking the buyerOrganization should not be equal to inventory organization
      inventories.forEach(async (inventory) => {
        if (buyerOrganization == inventory.ownerOrganization) {
          throw new rest.RestError(RestStatus.BAD_REQUEST, "Seller can not buy his own product");
        }
        const orderItem = orderList.find(item => item.inventoryId == inventory.address);
        if (orderItem) {
          inventory.quantity = orderItem.quantity;

        }

      });



      const groupedData = inventories.reduce((acc, inventory) => {
        if (!acc[inventory.productId]) {
          const taxRate = (inventory.taxDollarAmount === 0 ? inventory.taxPercentageAmount : inventory.taxDollarAmount) / 100;
          acc[inventory.productId] = { ownerOrganization: inventory.ownerOrganization, tax: taxRate, isTaxPercentage: inventory.taxDollarAmount === 0, data: [] };
        }
        acc[inventory.productId].data.push(inventory);
        return acc;
      }, {});

      const inventoriesData = Object.values(groupedData);
      const total = inventoriesData.reduce((acc, obj) => {
        const result = obj.data.reduce((total, curr) => obj.tax !== 0 ?
          (obj.isTaxPercentage ?
            ((total + ((curr.pricePerUnit * curr.quantity) * (1 + (obj.tax / 100)))) * 100) / 100
            : total + (curr.pricePerUnit * curr.quantity) + (obj.tax * curr.quantity)
          ) : (total + curr.pricePerUnit * curr.quantity), 0);
        return Number(acc) + Number(result);
      }, 0).toFixed(2);

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
          buyerComments: '',
          sellerComments: '',
          createdDate, paymentSessionId, shippingAddress
        }

        const [statusCode, orderAddress] = await managers.orderManager.createOrder(orderArgs);
        orders.push([statusCode, orderAddress]);

        // add orderLine for inventories
        for (const inventoryObject of inventory.data) {

          const shippingCharges = (inventoryObject.pricePerUnit * inventoryObject.quantity) * CHARGES.SHIPPING;
          const tax = (inventoryObject.pricePerUnit * inventoryObject.quantity) * CHARGES.SHIPPING;

          await managers.orderManager.addOrderLine({
            orderAddress,
            productId: inventoryObject.productId,
            inventoryId: inventoryObject.address,
            quantity: inventoryObject.quantity,
            pricePerUnit: inventoryObject.pricePerUnit,
            shippingCharges,
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


  contract.createMembership = async function (args, options = defaultOptions) {
    try {

      const { membershipArgs, membershipServiceArgs, productFileArgs } = args;

      const createOptions = { ...options, org: managers.cirrusOrg, app: contractName };

      const [status, membershipAddress, productAddress] = await managers.membershipManager.createMembership({
        dappAddress: contract.address,
        membershipArgs: membershipArgs,
        membershipServiceArgs: membershipServiceArgs,
        productFileArgs: productFileArgs
      });

      return { status, membershipAddress, productAddress };
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while creating the membership");
    }

  };

  contract.getPurchasedMemberships = async function (args, options = defaultOptions) {
    try {
      const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
      // const ownedProducts = Get Products where ownerOrg === userOrg and Manufacturer !== userOrg and Category == 'Membership'
      let ownedProducts = await managers.productManager.getProducts({ category: 'Membership', ownerOrganization: userOrganization, notEqualsField: 'manufacturer', notEqualsValue: userOrganization }, getOptions);
      // ownedProducts = ownedProducts.filter(m => userOrganization !== m.manufacturer && m.ownerOrganization === userOrganization)

      const arrayOfAddresses = ownedProducts.map(obj => obj.address);
      const args = {
        ownerOrganization: userOrganization,
        productId: arrayOfAddresses,
        sort: '-createdDate',
      }

      // Get Items where productId = ownedProducts.productId and ownerOrg === userOrg
      // let ownedMem = await membershipJs.getAll(rawAdmin, args, getOptions);
      let ownedItems = await itemJs.getAll(rawAdmin, args, getOptions);
      let inventoriesAddresses = ownedItems.map(item => item.inventoryId)
      const inventoriesList = await managers.productManager.getInventories({ address: inventoriesAddresses }, getOptions);
      // Filter ownedItems based on productId and ownerOrg
      // ownedItems = ownedItems.filter(item =>
      //   ownedProducts.some(product => item.productId === product.address)
      // );
      console.log("ownedItems", ownedItems)
      
      // Get Memberhships where productId = Items.productId 
      let ownedMemberships = await membershipJs.getAll(rawAdmin, {
        productId: arrayOfAddresses,
        sort: '-createdDate'
      }, getOptions); //ownerOrganization: userOrganization
      // ownedMemberships = ownedMemberships.filter(membership =>
      //   ownedItems.some(item => membership.productId === item.productId)
      // );
      console.log ('ownedMemberships', ownedMemberships)
      
      const arrayOwnedMemberships = ownedMemberships.map(obj => obj.address);
      // Get MembershipServices where membershipId = ownedMemberships.address 
      const membershipServices = (await membershipServiceJs.getAll(rawAdmin, { membershipId: arrayOwnedMemberships }, getOptions));
      const arrayMembershipServices= membershipServices.map(obj => obj.serviceId);
      // Get all services
      const servicesAll = await managers.serviceManager.getAll({address: arrayMembershipServices }, { ...options, org: managers.cirrusOrg, app: contractName, });
      
      console.log('membershipServices:', membershipServices)
      console.log('servicesAll:', servicesAll)

      // Get ProductFile where productId = Items.productId
      let ownedProductFiles = await productFileJs.getAll(rawAdmin, {
        productId: arrayOfAddresses,
        sort: '-createdDate'
      }, { ...options, org: managers.cirrusOrg, app: contractName, });

      // { ...options, org: managers.cirrusOrg, app: contractName, }
      ownedProductFiles = ownedProductFiles.filter(file =>
        ownedItems.some(item => file.productId === item.productId)
      );
      console.log('ownedProductFiles', ownedProductFiles)
      // TODO: What if there are not product files? Should we throw an error?
      // TODO: What if there are multiple product files? Should we display all of them?
      // Combine ownedProducts, ownedItems, ownedMemberships, and ownedProductFiles into one JSON object array
      const combinedData = ownedItems
        .filter(item => {
          const product = ownedProducts.find(p => p.address === item.productId);
          const memberships = ownedMemberships.filter(m => m.productId === item.productId);
          const productFiles = ownedProductFiles.filter(file => file.productId === item.productId);

          return product
            && productFiles.length > 0 && memberships.length > 0
        })
        .map(item => {
          const product = ownedProducts.find(p => p.address === item.productId);
          const memberships = ownedMemberships.filter(m => m.productId === item.productId);
          let productFiles = ownedProductFiles.filter(file => file.productId === item.productId);
          if (productFiles?.length > 0) {
            productFiles = productFiles.map(item => item.fileLocation)
          } else {
            productFiles = []
          }
          const savings = membershipServices
            .filter(
              (membershipService) =>
                membershipService.membershipId === memberships[0].address
            )
            .map((membershipService) => {
              const matchingService = servicesAll.find(
                (service) => service.address === membershipService.serviceId
              );

              if (matchingService) {
                return {
                  savings:
                    membershipService.maxQuantity *
                    (matchingService.price - membershipService.membershipPrice),
                };
              } else {
                return " Not found";
              }
            });

          // console.log("savings: ", savings)
          let inventoryDetail = inventoriesList.find((inventory) => inventory.address === item.inventoryId);
          return {
            itemAddress: item.address,
            itemNumber: item.itemNumber,
            productId: item.productId,
            inventoryId: item.inventoryId,
            availableQuantity: inventoryDetail?.availableQuantity,
            fileLocation: productFiles, // comment for resale test
            status: inventoryDetail?.status,
            productName: product.name,
            subCategory: product.subCategory,
            manufacturer: product.manufacturer,
            timePeriodInMonths: memberships[0].timePeriodInMonths,
            savings: savings[0]?.savings,
            membershipAddress: memberships[0].address
          };
        });

      return combinedData;
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error at getPurchasedMemberships");
    }

  };

  contract.getIssuedMemberships = async function (args, options = defaultOptions) {
    try {
      const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
      let issuedProducts = await managers.productManager.getProducts({ category: 'Membership', manufacturer: userOrganization }, getOptions);

      const arrayOfAddresses = issuedProducts.map(obj => obj.address);
      const args = {
        notEqualsField: 'ownerOrganization',
        notEqualsValue: userOrganization,
        productId: arrayOfAddresses,
        sort: '-createdDate',
      }

      // Get Items where productId = ownedProducts.productId and ownerOrg === userOrg
      let issuedItems = await itemJs.getAll(rawAdmin, args, getOptions);

      // Combine issuedProducts, issuedItems, issuedMemberships, and issuedProductFiles into one JSON object array
      const combinedData = issuedItems
        .filter(item => {
          const product = issuedProducts.find(p => p.address === item.productId);
          // const memberships = issuedMemberships.filter(m => m.productId === item.productId);
          // const productFiles = issuedProductFiles.filter(file => file.productId === item.productId);

          return product //&& productFiles.length > 0; //&& memberships.length > 0
        })
        .map(item => {
          const product = issuedProducts.find(p => p.address === item.productId);
          // const memberships = issuedMemberships.filter(m => m.productId === item.productId);
          // const productFiles = issuedProductFiles.filter(file => file.productId === item.productId);

          return {
            itemAddress: item.address,
            itemNumber: item.itemNumber,
            productId: item.productId,
            owner: item.owner,
            ownerCommonName: item.ownerCommonName,
            fileLocation: null,//productFiles[0].fileLocation,
            productName: product.name,
            subCategory: product.subCategory,
            manufacturer: product.manufacturer,
            timePeriodInMonths: null,//memberships[0].timePeriodInMonths,
            savings: null, //memberships[0].savings,
            membershipAddress: null //memberships[0].address
          };
        }) //.filter((item) => item.manufacturer === userOrganization)

      return combinedData;
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error at getIssuedMemberships");
    }

  };

  contract.updateBuyerDetails = async function (args, options = defaultOptions) {
    try {
      const { address, chainId, updates } = args;

      const contract = { name: orderJs.contractName, address: address };

      const createOptions = { ...options, org: managers.cirrusOrg, app: contractName };
      if (updates.status == ORDER_STATUS.CANCELED) {
        const [statusResponse, inventoryAddresses, quantitiesToUpdate] =
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

        // const newOptions = { ...chainOptions, org: managers.cirrusOrg, app: contractName }

        const orderLines = await managers.orderManager.getOrderLines({ orderAddress: address }, createOptions);
        const orderLinesAddresses = orderLines.map(orderLine => orderLine.address);

        let itemAddresses
        let newOwner = orderLines[0].owner
        let result = []

        for (let orderLineAddress of orderLinesAddresses) {
          const orderLineItems = await managers.orderManager.getOrderLineItems({ orderLineId: orderLineAddress }, createOptions)
          console.log("dapp orderLineItems: ", orderLineItems)
          itemAddresses = orderLineItems.map(orderLineItem => orderLineItem.itemId);
          console.log("dapp itemAddresses: ", itemAddresses)
          // Get items and get the productIds
          const items = await managers.itemManager.getItems({ address: itemAddresses }, createOptions);
          console.log("dapp items: ", items)
          const productAddresses = items.map(item => item.productId);
          console.log("dapp productAddresses: ", productAddresses)

          // Using the productIds, get the memberships
          let memberships = await membershipJs.getAll(rawAdmin, { productId: productAddresses }, createOptions)
          console.log("here")
          console.log("dapp memberships:", memberships)
          const membershipAddresses = memberships.map(membership => membership.address);

          // Transfer ownership of the items to the buyer
          const [status, productId, inventoryId] = await managers.itemManager.transferOwnership({ itemsAddress: itemAddresses, newOwner, dappAddress });
          console.log("dapp productId: ", productId)
          console.log("dapp inventoryId: ", inventoryId)

          // Get all membershipServices using membershipId
          const membershipServices = await membershipServiceJs.getAll(rawAdmin, { membershipId: membershipAddresses }, createOptions)
          console.log("dapp membershipServices: ", membershipServices)

          // Get all productFiles using productId
          const productFiles = await productFileJs.getAll(rawAdmin, { productId: productAddresses }, createOptions)
          console.log("dapp productFiles: ", productFiles)

          const membershipArgs = {
            createdDate: memberships[0].createdDate,
            timePeriodInMonths: memberships[0].timePeriodInMonths,
            additionalInfo: memberships[0].additionalInfo
          }

          const membershipServiceArgs = membershipServices.map((membershipService) => {
            return {
              serviceId: membershipService.serviceId,
              membershipPrice: membershipService.membershipPrice,
              discountPrice: membershipService.discountPrice,
              maxQuantity: membershipService.maxQuantity,
              createdDate: membershipService.createdDate,
              isActive: membershipService.isActive,
            };
          });

          const productFileArgs = productFiles.map((productFile) => {
            return {
              fileLocation: productFile.fileLocation,
              fileHash: productFile.fileHash,
              fileName: productFile.fileName,
              uploadDate: productFile.uploadDate,
              createdDate: productFile.createdDate,
              currentSection: productFile.currentSection,
              currentType: productFile.currentType,
            };
          });



          console.log("comes here")
          const memberResponse = await managers.membershipManager.addMembershipOrderFlow({
            dappAddress: contract.address,
            owner: newOwner,
            productId: productId,
            membershipArgs: membershipArgs,
            membershipServiceArgs: membershipServiceArgs,
            productFileArgs: productFileArgs
          });
          console.log("reach here: ", memberResponse)
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

  contract.resaleMembership = async function (args, options = defaultOptions) {
    // console.log("payload", args);
    let {itemAddress, ...restArgs} = args
    const inventoryRes = await managers.productManager.updateInventory(restArgs);
        const [soldStatus] = await managers.itemManager.updateItem({
        itemsAddress: [itemAddress],
        status: ITEM_STATUS.PUBLISHED,
        comment: "",
      });
    return soldStatus
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

      for (let i = 0; i < result.orderLines.length; i++) {
        const { productId, inventoryId } = result.orderLines[i];
        const items = await managers.itemManager.getItems({ productId, inventoryId }, createOptions);

        if (items === null || items === undefined || items.length === 0) {
          result.orderLines[i].containsSerialNumber = false;
        }
        else if (items.length > 0 && items[0].serialNumber == "") {
          result.orderLines[i].containsSerialNumber = false;
        } else {
          result.orderLines[i].containsSerialNumber = true;
        }
      }

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
          orderLine.manufacturer = product.manufacturer;
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

  contract.createOrderLineItem = async function (args, options = defaultOptions) {
    try {
      const { orderLineId, serialNumber } = args;
      const quantity = args.quantity || 0;
      const chainOptions = { ...options, org: managers.cirrusOrg, app: contractName, };

      const orderLine = await managers.orderManager.getOrderLine({ address: orderLineId }, chainOptions);
      const { productId, inventoryId } = orderLine

      // If no serial numbers are passed, a quantity is passed from the front end. 
      // This will allow us to get the first n items from the inventory
      // quantity is set to 0 if serial numbers are provided, so we can get the items by serial number
      let items;
      if (quantity > 0) {
        items = await managers.itemManager.getItems(
          {
            productId,
            inventoryId,
            offset: 0,
            limit: quantity,
            status: 1
          },
          chainOptions
        );
      } else {
        items = await managers.itemManager.getItems(
          {
            productId,
            inventoryId,
            serialNumber: [...serialNumber]
          },
          chainOptions
        );
      }
      if (serialNumber && serialNumber.length !== 0 && serialNumber.length !== items.length) {
        throw new rest.RestError(RestStatus.CONFLICT, "Serial numbers are different than the actual inventory");
      }

      const _contract = { name: orderLineJs.contractName, address: orderLineId };

      const itemsAddresses = items.map(_item => _item.address);


      const _args = {
        orderLineId,
        items: itemsAddresses,
        createdDate: Math.floor(Date.now() / 1000),
      };
      // This gives me a status of 200 and the orderLineItems, but the _items is undefined. 
      // See orderLine.sol 
      // Item_3 item = Item_3(account(address(_items[i]),"parent"));

      const [status, orderLineItems, _items] = await managers.orderManager.addOrderLineItems(_args);
      const result = orderLineItems.split(",");

      const [soldStatus] = await managers.itemManager.updateItem({
        itemsAddress: itemsAddresses,
        status: ITEM_STATUS.SOLD,
        comment: "",
      });
      if (soldStatus !== "200") {
        throw new rest.RestError(RestStatus.BAD_REQUEST, "Sold status was not updated");
      }

      return result;
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while creating the Order Line Item");
    }
  };

  contract.getOrderLine = async function (args = {}, options = optionsNoChainIds) {
    try {

      const { address } = args;
      const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
      const orderLine = await managers.orderManager.getOrderLine({ ...args, }, getOptions);

      const inventory = await contract.getInventory({ address: orderLine.inventoryId, });
      const orderLineItems = await managers.orderManager.getOrderLineItems({ orderLineId: orderLine.address, }, getOptions);

      return { ...inventory, items: orderLineItems, };
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while Fetching  the OrderLine");
    }
  };

  contract.getOrderLineItem = async function (args, options = optionsNoChainIds) {
    try {
      return managers.orderManager.getOrderLineItem(args, { ...options, org: managers.cirrusOrg, app: contractName });
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while Fetching  the OrderLineItem");
    }
  };


  contract.getOrderLineItems = async function (args = {}, options = optionsNoChainIds) {
    try {
      const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
      return managers.orderManager.getOrderLineItems({ ...args, }, getOptions);
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while Fetching the OrderLineItems");
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
  //-----------------------------Membership starts here -------------------------------
  // contract.createMembership = async function (args, options = defaultOptions) {
  //   const createOptions = {...options, org: managers.cirrusOrg, app: contractName }

  //   const membership = membershipManagerJs.createMembership(rawAdmin, args, createOptions)
  //   console.log('dapp membershipManagerJs.createMembership', membership)
  //   return membership
  // }

  contract.getMembership = async function (args, options = optionsNoChainIds) {
    // May need to insert contractName in options when this goes throught the product manager
    // This param was hard coded for the get and getAll functions for Membership and MembershipService below

    // Get The membership
    const membership = await membershipJs.get(rawAdmin, args, { ...options, org: managers.cirrusOrg, app: contractName })

    // Get The productFiles
    console.log("start", membership.productId)
    var productFiles = undefined
    if (membership.productId) {
      productFiles = await productFileJs.getAll(rawAdmin, { productId: membership.productId }, { ...options, org: managers.cirrusOrg, app: contractName })
    }


    // Get all membershipServices
    const membershipServices = (await membershipServiceJs.getAll(rawAdmin, { membershipId: membership.address }, { ...options, org: managers.cirrusOrg, app: contractName }));

    // Get all services
    const servicesAll = await managers.serviceManager.getAll({ ownerOrganization: membership.manufacturer }, { ...options, org: managers.cirrusOrg, app: contractName, });

    // Combine the data and merge the service data into the membershipService data
    const combinedData = {
      membership: membership,
      membershipServices: membershipServices.map(membershipService => {
        const matchingService = servicesAll.find(service => service.address === membershipService.serviceId);

        if (matchingService) {
          return {
            ...membershipService,
            savings: membershipService.maxQuantity * (matchingService.price - membershipService.membershipPrice),
            serviceName: matchingService.name,
            serviceDescription: matchingService.description,
            servicePrice: matchingService.price,
            serviceCreatedDate: matchingService.createdDate
          };
        } else {
          return membershipService;
        }
      }),
      productFiles: productFiles
    };
    return combinedData
  }

  //This returns a list of memberships with corresponding products and inventory statuses
  //Note  Inventories to Products should be Surjective(IE, every membership should have a productID)
  //Note that memberships should be surjective to Products (some data has ProductId as null)
  //Also note that there maybe multiple inventories that map to a single product that correspond to a single membership
  contract.getMemberships = async function (args = {}, options = optionsNoChainIds) {
    const oldOptions = { ...options, app: contractName }
    const newOptions = { ...options, org: managers.cirrusOrg, app: contractName }

    const products = await managers.productManager.getProducts({ ownerOrganization: userOrganization }, newOptions);
    let addressOfProducts = products.map(item => item.address)

    // Get all memberships
    let memberships = await membershipJs.getAll(rawAdmin, { ...args, sort: '-createdDate', productId: addressOfProducts }, newOptions)

    //filter out memberships with null productIds and memberships that don't belong to the user's organization
    memberships = memberships.filter(m => m.productId !== null && m.productId !== undefined && m.ownerOrganization === userOrganization)

    //Get the list of productIds for API calls
    // const addressOfProducts = memberships.map(membership => membership.productId);

    //Get Products
    // const products = await managers.productManager.getProducts({ address: addressOfProducts }, newOptions);

    //Attach product to membership
    products.forEach(product => {
      memberships = memberships.map(membership => {
        return (membership.productId === product.address) ?
          { ...membership, product: product, productImage: null, inventories: [] } : membership;
      })
    })

    //Get Product Image Info
    const productImageInfo = await productFileJs.getAll(rawAdmin, { productId: addressOfProducts }, { ...options, org: managers.cirrusOrg, app: contractName });

    //Attach Product Image Info to Corresponding Membership
    productImageInfo.forEach(productImage => {
      memberships = memberships.map(membership => {
        return (membership.productId === productImage.productId) ?
          { ...membership, productImage: productImage } : membership;
      })
    })

    //Get inventories using the corresponding ProductIds
    const inventories = await managers.productManager.getInventories({ productId: addressOfProducts }, newOptions);

    //iterate through the list of inventories and attach the inventory status to the membership object
    inventories.forEach(inventory => {
      memberships = memberships.map(membership => {
        let transformedData = { inventories: [], ...membership }
        return (membership.productId === inventory.productId) ?
          { ...membership, inventories: [...transformedData.inventories, inventory] } : membership;
      })
    })

    const membershipAddressList = memberships.map(membership => membership.address);
    //Get Services for price savings
    const membershipServices = await membershipServiceJs.getAll(rawAdmin, { membershipId: membershipAddressList }, { ...options, org: managers.cirrusOrg, app: contractName });

    const serviceAddresses = membershipServices.map(membershipService => membershipService.serviceId);

    // const servicesAll = await managers.serviceManager.getAll({ownerOrganization: userOrganization  }, { ...options, org: managers.cirrusOrg, app: contractName, });
    const servicesAll = await managers.serviceManager.getAll({ address: serviceAddresses }, { ...options, org: managers.cirrusOrg, app: contractName, });
    membershipServices.forEach(membershipService => {
      servicesAll.forEach(service => {
        if (service.address === membershipService.serviceId) {
          memberships = memberships.map(membership => {
            return ((membership.address === membershipService.membershipId)) ?
              {
                ...membership,
                //Note we might have multiple service per membership
                savings: (membership.hasOwnProperty('savings') ?
                  membership.savings : 0) + (service.price - membershipService.membershipPrice)
              }
              : membership;
          })
        }
      })
    })

    console.log("Dapp-getMemberships memberships: ", memberships)

    return memberships;
  }

  contract.transferOwnershipMembership = async function (args, options = defaultOptions) {
    const { address, chainId, newOwner } = args

    const contract = {
      name: membershipJs.contractName,
      address: address,
    }

    const chainOptions = { chainIds: [chainId], ...options }

    return membershipJs.transferOwnership(rawAdmin, contract, chainOptions, newOwner)
  }

  contract.updateMembership = async function (args, options = defaultOptions) {
    const { address, chainId, updates } = args;

    const contract = {
      name: membershipJs.contractName,
      address: address,
    };

    const chainOptions = { chainIds: [chainId], ...options };

    return membershipJs.update(rawAdmin, contract, updates, chainOptions);
  }

  //-----------------------------Membership ends here -------------------------------
  //-----------------------------Membership Service starts here -------------------------------

  contract.createMembershipService = async function (args, options = defaultOptions) {
    const createOptions = { ...options, org: managers.cirrusOrg, app: contractName }
    return membershipServiceJs.uploadContract(rawAdmin, args, createOptions);
  }

  contract.getMembershipService = async function (args, options = optionsNoChainIds) {
    return membershipServiceJs.get(rawAdmin, args, { ...options, org: managers.cirrusOrg, app: "" })
  }

  contract.getMembershipServices = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: "" }
    const out = await membershipServiceJs.getAll(rawAdmin, {
      ...args
    }, getOptions)
    console.log("getMembershipServices getOptions: ", getOptions)
    console.log("getMembershipServices: ", out)
    return out
  }

  contract.transferOwnershipMembershipService = async function (args, options = defaultOptions) {
    const { address, chainId, newOwner } = args

    const contract = {
      name: membershipServiceJs.contractName,
      address: address,
    }

    const chainOptions = { chainIds: [chainId], ...options }

    return membershipServiceJs.transferOwnership(rawAdmin, contract, chainOptions, newOwner)
  }

  contract.updateMembershipService = async function (args, options = defaultOptions) {
    const { address, chainId, updates } = args;

    const contract = {
      name: membershipServiceJs.contractName,
      address: address,
    };

    const chainOptions = { chainIds: [chainId], ...options };

    return membershipServiceJs.update(rawAdmin, contract, updates, chainOptions);
  }

  //-----------------------------Membership Service ends here -------------------------------

  contract.createEventType = async function (args, options = defaultOptions) {
    try {

      const createdDate = Math.floor(Date.now() / 1000);
      return managers.eventTypeManager.createEventType({ ...args, createdDate, });
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while Fetching the OrderLineItems");
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

  contract.certifyEvent = async function (args, options = defaultOptions) {
    const { eventBatchId, updates } = args;
    const certifiedDate = Math.floor(Date.now() / 1000);
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
    const eventAddress = [];
    const events = await managers.itemManager.getEvents({ eventBatchId: [...eventBatchId] }, getOptions);

    events.forEach(event => {
      if (event.certifiedDate !== null) {
        throw new rest.RestError(RestStatus.CONFLICT, { message: "events are already certified" });
      }
      eventAddress.push(event.address)
    });

    return managers.itemManager.certifyEvent({ eventAddress, certifiedDate, updates });
  };

  contract.auditEvent = async function (args, options = defaultOptions) {
    const { address, chainId } = args;
    const auditOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
    return eventJs.getHistory(rawAdmin, chainId, address, auditOptions);
  };

  //----------------------------- Service (Start ->) -------------------------------
  contract.createService = async function (args, options = defaultOptions) {
    try {
      const createdDate = Math.floor(Date.now() / 1000);
      return managers.serviceManager.createService({ ...args, createdDate, });
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while createService");
    }
  };

  contract.getService = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
    return managers.serviceManager.get({ ...args }, getOptions);
  };

  contract.getServices = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: contractName, };
    return managers.serviceManager.getAll({ ...args, sort: '-createdDate' }, getOptions);
  };

  contract.updateService = async function (args, options = defaultOptions) {
    const { address, updates } = args;

    const contract = {
      name: serviceJs.contractName,
      address: address,
    };

    // const chainOptions = { chainIds: [chainId], ...options };

    return serviceJs.update(rawAdmin, contract, updates, options);
  }

  //----------------------------- ProductFile (Start ->) -------------------------------
  contract.createProductFile = async function (args, options = defaultOptions) {
    try {
      const createdDate = Math.floor(Date.now() / 1000);
      const createOptions = { ...options, org: managers.cirrusOrg, app: contractName };
      return productFileJs.uploadContract(rawAdmin, { ...args, createdDate, }, createOptions);
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while createProductFile");
    }
  };

  contract.getProductFile = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: "", };
    return productFileJs.get(rawAdmin, { ...args, ownerOrganization: userOrganization }, getOptions)
  };

  contract.getProductFiles = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: "", };
    return productFileJs.getAll(rawAdmin, { ...args, sort: '-createdDate', ownerOrganization: userOrganization }, getOptions)
  };

  contract.updateProductFile = async function (args, options = defaultOptions) {
    const { address, updates } = args;

    const contract = {
      name: productFileJs.contractName,
      address: address,
    };

    // const chainOptions = { chainIds: [chainId], ...options };

    return productFileJs.update(rawAdmin, contract, updates, options);
  };

  //----------------------------- ServiceUsage (Start ->) -------------------------------
  contract.createServiceUsage = async function (args, options = defaultOptions) {
    try {
      const createdDate = Math.floor(Date.now() / 1000);
      const createOptions = { ...options, org: managers.cirrusOrg, app: contractName };
      return serviceUsageJs.uploadContract(rawAdmin, { ...args, createdDate, }, createOptions);
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while createServiceUsage");
    }
  };

  contract.getServiceUsage = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: "", };
    const serviceUsage = await serviceUsageJs.getAll(rawAdmin, { ...args }, getOptions)
    const memberships = await contract.getPurchasedMemberships();
    const data = serviceUsage.map((item, index) => {
      let result = memberships.find((mItem) => mItem.itemAddress === item.itemId) ?? '';
      return { ...item, provider: result.manufacturer }
    })
    return data
  };

  contract.getBookedServiceUsage = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: '' };

    const serviceUsage = await serviceUsageJs.getAll(rawAdmin, {
      ...args,
      sort: '-createdDate',
      // owner: userAddress, 
      // ownerOrganization: userOrganization,
      bookedUserAddress: userAddress
    }, getOptions);

    const memberships = await contract.getPurchasedMemberships();
    const services = await contract.getServices();
    const users = await contract.getCertificates();

    const data = serviceUsage['serviceUsage'].map((item) => ({
      ...item,
      provider: (memberships.find((mItem) => mItem.itemAddress === item.itemId) || {}).manufacturer || '',
      serviceName: (services.find((sId) => sId.address === item.serviceId) || {}).name || '',
      membershipNumber: (memberships.find((mItem) => mItem.itemAddress === item.itemId) || {}).itemNumber || '',
      bookedUserName: (users.find((uItem) => uItem.userAddress === item?.bookedUserAddress) || {}).commonName || '',
    }));

    return { result: data, total: serviceUsage.total };
  };

  contract.getProvidedServiceUsages = async function (args = {}, options = optionsNoChainIds) {
    const getOptions1 = { ...options, org: managers.cirrusOrg, app: contractName, };
    let issuedProducts = await managers.productManager.getProducts({ category: 'Membership', manufacturer: userOrganization }, getOptions1);

    const arrayOfProductAddresses = issuedProducts.map(obj => obj.address);

    const arg = {
      productId: arrayOfProductAddresses,
      notEqualsValue: userOrganization,
      notEqualsField: 'ownerOrganization',
    };

    let issuedItems = await itemJs.getAll(rawAdmin, arg, getOptions1);
    let itemAddressList = issuedItems.map(item => item.address);
    const args1 = {
      // ownerOrganization: userOrganization,
      // providerLastUpdated:userAddress,
      itemId: itemAddressList
    }

    const getOptions = { ...options, org: managers.cirrusOrg, app: "", };
    const serviceUsage = await serviceUsageJs.getAll(rawAdmin, { itemId: itemAddressList, ...args, sort: '-createdDate' }, getOptions)
    const services = await contract.getServices();
    const memberships = await contract.getIssuedMemberships();
    const users = await contract.getCertificates()
    const data = serviceUsage['serviceUsage'].map((item) => ({
      ...item,
      provider: (memberships.find((mItem) => mItem.itemAddress === item.itemId) || {}).manufacturer || '',
      serviceName: (services.find((sId) => sId.address === item.serviceId) || {}).name || '',
      membershipNumber: (memberships.find((mItem) => mItem.itemAddress === item.itemId) || {}).itemNumber || '',
      bookedUserName: (memberships.find((uItem) => uItem.owner === item?.bookedUserAddress) || {}).ownerCommonName || '',
    }));

    return { result: data, total: serviceUsage.total };

  };

  contract.updateServiceUsage = async function (args, options = defaultOptions) {
    const { address, updates } = args;

    const contract = {
      name: serviceUsageJs.contractName,
      address: address,
    };
    // const chainOptions = { chainIds: [chainId], ...options };
    return serviceUsageJs.update(rawAdmin, contract, updates, options);
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