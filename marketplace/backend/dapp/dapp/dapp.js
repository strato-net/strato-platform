import { rest, util, importer } from "blockapps-rest";
const { createContract } = rest;
import constants, { CHARGES, ITEM_STATUS, ORDER_STATUS, SERVICE_PROVIDERS } from "/helpers/constants";
import { yamlWrite, yamlSafeDumpSync, getYamlFile } from "/helpers/config";
import StripeService from "/payment-service/stripe.service";
import dayjs from 'dayjs';
import RestStatus from 'http-status-codes';
// import organizationManagerJs from '/dapp/organizations/organizationManager'
import certificateJs from "/dapp/certificates/certificate";

import categoryManagerJs from "/dapp/categories/categoryManager";
import categoryJs from "/dapp/categories/category";
import subCategoryJs from "/dapp/categories/subCategory";
import itemJs from "/dapp/items/item";
import orderChainJs from "/dapp/assets/Order/orderChain";
import orderJs from "/dapp/assets/Order/order";
import orderLineItemJs from "/dapp/assets/Order/orderLineItem";
import orderLineJs from "/dapp/assets/Order/orderLine";

import eventTypeJs from "/dapp/eventType/eventType";
import eventTypeManagerJs from "/dapp/eventType/eventTypeManager";
import eventJs from "/dapp/assets/Event/event";
import itemManagerJs from "/dapp/items/itemManager";
import productManagerJs from "/dapp/products/productManager";
import marketplaceJs from "/dapp/marketplace/marketplace.js";
import userAddressJs from "/dapp/addresses/userAddress.js";
import { orderLineItemArgs } from "../../test/v1/factories/orderLineItem";
import { RestError } from "blockapps-rest/dist/util/rest.util";
import paymentManagerJs from "/dapp/payments/paymentManager";
import paymentProviderJs from '/dapp/payments/paymentProvider';


const allAssetNames = [
  orderJs.contractName,
  // orderLineItemJs.contractName,
  categoryJs.contractName,
  subCategoryJs.contractName,
  categoryManagerJs.contractName,
  eventTypeJs.contractName,
  eventTypeManagerJs.contractName,
];

const contractName = "Dapp";
const mainChainContractName = "MyApp";
const contractFileName = `dapp/dapp/contracts/Dapp.sol`;

const balance = 100000000000000000000;

// interface Member {
//   access?:boolean,
//   orgName?:string,
//   orgUnit?:string,
//   commonName?:string
// }

async function uploadDappChain(
  user,
  mainChainAddress,
  initialMembers,
  defaultOptions
) {
  const getKeyResponse = await rest.getKey(user, defaultOptions);
  const uid = util.uid();

  const myCert = await certificateJs.getCertificateMe(user);

  const members = myCert
    ? [
      ...initialMembers,
      {
        orgName: myCert.organization,
        orgUnit: myCert.organizationalUnit || "",
        commonName: "",
        access: true,
      },
    ]
    : initialMembers.length > 0
      ? initialMembers
      : [{}];

  const chainArgs = {
    name: contractName,
    label: `tCommerceDapp-Shard_${uid}`,
    codePtr: {
      account: mainChainAddress,
      name: contractName,
    },
    args: {},
    members,
    balances: [
      {
        address: getKeyResponse,
        balance,
      },
      {
        address: "0000000000000000000000000000000000000100",
        balance,
      },
    ],
    metadata: {
      VM: "SolidVM",
    },
  };

  const contractArgs = { name: contractName };

  const optionsWithHistory = {
    ...defaultOptions,
    history: [allAssetNames],
  };

  const chain = await rest.createChain(
    user,
    chainArgs,
    contractArgs,
    optionsWithHistory
  );

  return bind(
    user,
    {
      name: contractName,
      address: constants.governanceAddress,
    },
    {
      chainIds: [chain],
      ...defaultOptions,
    }
  );
}

function deploy(contract, args, options) {
  console.log(options);
  // author the deployment
  const { deployFilePath } = args;

  const deployment = {
    url: options.config.nodes[0].url,
    dapp: {
      contract: {
        name: contract.name,
        address: contract.address,
        appChainId: options.chainIds[0],
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
    chainIds: [deployFile.dapp.contract.appChainId],
    ...options,
  });
}

async function uploadMainChainContract(token, options) {
  const source = await importer.combine(contractFileName);
  const contractArgs = {
    name: mainChainContractName,
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
  const categoryManager = categoryManagerJs.bindAddress(admin, state.categoryManager, options);
  const itemManager = await itemManagerJs.bindAddress(admin, state["itemManager"], options);
  const productManager = await productManagerJs.bindAddress(admin, state["productManager"], options);
  const eventTypeManager = await eventTypeManagerJs.bindAddress(admin, state.eventTypeManager, options);
  const paymentManager = await paymentManagerJs.bindAddress(admin, state.paymentManager, options)

  const cirrusOrg = state.bootUserOrganization !== "" ? state.bootUserOrganization : undefined;

  return { cirrusOrg, categoryManager, productManager, eventTypeManager, itemManager, paymentManager };
}

async function bind(rawAdmin, _contract, _defaultOptions) {
  const contract = _contract;
  const userCertificate = await certificateJs.getCertificateMe(rawAdmin);
  contract.userOrganization = userCertificate.organization
  const managers = await getManagersAndCirrusInfo(rawAdmin, contract, _defaultOptions)
  // includes the org+app for cirrus namespacing (helpers/utils.js will prepend to cirrus queries)
  const defaultOptions = { ..._defaultOptions, org: managers.cirrusOrg, app: contractName, };
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
  contract.getCertificateMe = async function () {
    return certificateJs.getCertificateMe(admin);
  };
  contract.getCertificates = async function (args) {
    return certificateJs.getCertificates(admin, args);
  };

  // ------------------------------ ITEMS --------------------------------
  contract.addItem = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    return managers.itemManager.addItem({ appChainId: contract.chainId, ...args.itemArgs, createdDate: createdDate, });
  };
  contract.updateItem = async function (args, options = defaultOptions) {
    return managers.itemManager.updateItem(args);
  };
  contract.getItems = async function (args = {}, options = defaultOptions) {
    console.log("dapp.getAllItems args:", args);
    const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
    return managers.itemManager.getItems({ appChainId: contract.chainId, ...args }, getOptions);
  };

  // ------------------------------ EVENTS --------------------------------
  contract.createEvent = async function (args, options = optionsNoChainIds) {
    try {

      const { productId, serialNumbers } = args;
      const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };

      const eventBatchId = util.uid();
      const createdDate = Math.floor(Date.now() / 1000);

      const serialNosBatch = 200
      const itemsAddressArr = []

      for (let i = 0; i < serialNumbers.length; i += serialNosBatch) {
        const serialNumberArr = serialNumbers.slice(i, i + serialNosBatch);

        const items = await managers.itemManager.getItems({ appChainId: contract.chainId, productId: productId, serialNumber: serialNumberArr }, getOptions)

        if (items.length != serialNumberArr.length) {
          throw new rest.RestError(RestStatus.CONFLICT,
            "Invalid serial numbers for product")
        }
        items.forEach(item => itemsAddressArr.push(item.address))
      }

      if (!args.certifier) args.certifier = constants.zeroAddress
      return managers.itemManager.addEvent({ itemsAddress: itemsAddressArr, appChainId: contract.chainId, ...args, eventBatchId: eventBatchId, createdDate: createdDate, });
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
      app: mainChainContractName,
    };

    const { filterByCertifier, ...restArgs } = args
    if (filterByCertifier) {
      restArgs.certifier = rawAdmin.address;
    }

    const events = await managers.itemManager.getEvents({
      appChainId: contract.chainId,
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
      appChainId: contract.chainId,
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
    const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };

    const items = await managers.itemManager.getItems({ appChainId: contract.chainId, inventoryId }, getOptions);

    const itemsAddress = items.map((item) => item.address);
    const events = await managers.itemManager.getEvents({ appChainId: contract.chainId, limit: 3000, itemAddress: [...itemsAddress] }, getOptions);

    const eventTypeIdSet = new Set()
    events.forEach((event) => {
      if (!eventTypeIdSet.has(event.eventTypeId)) {
        eventTypeIdSet.add(event.eventTypeId)
      }
    });

    const eventTypes = await managers.eventTypeManager.getAll({
      appChainId: contract.chainId,
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

    const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
    const items = await managers.itemManager.getItems({ appChainId: contract.chainId, inventoryId }, getOptions);

    const itemsAddress = items.map((item) => item.address);
    const events = await managers.itemManager.getEvents({ appChainId: contract.chainId, limit: 3000, eventTypeId, itemAddress: [...itemsAddress] }, getOptions);

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
      appChainId: contract.chainId,
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
    return managers.productManager.createProduct({ appChainId: contract.chainId, ...newArgs, createdDate: createdDate });
  };
  contract.updateProduct = async function (args, options = defaultOptions) {
    return managers.productManager.updateProduct(args);
  };
  contract.deleteProduct = async function (args, options = defaultOptions) {
    return managers.productManager.deleteProduct(args);
  };
  contract.createInventory = async function (args, options = defaultOptions) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
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
    if (serialNumber.length == 0 || serialNumber.length == undefined) {
      const randomNumber = parseInt(util.iuid())
      transformedArray.push({
        "itemNumber": randomNumber,
        "serialNumber": `${randomNumber}`,
        "rawMaterialProductName": [],
        "rawMaterialSerialNumber": [],
        "rawMaterialProductId": []
      });
      serialNumbers.push(`${randomNumber}`)
    }
    const [createInventoryStatus, createdInventoryAddress] = await managers.productManager.createInventory({ ...restArgs, createdDate, serialNumbers });


    const itemParams = {
      itemObject: transformedArray,
      createdDate,
      comment: "",
      productId: restArgs.productAddress,
      status: restArgs.status,
      inventoryId: createdInventoryAddress,
      appChainId: contract.chainId,
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
    const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
    const items = await managers.itemManager.getItems({ appChainId: contract.chainId, inventoryId }, getOptions);
    const itemsAddress = items.map((item) => item.address);
    await managers.productManager.updateInventory(args);
    const itemParams = { itemsAddress, comment: "", status: args.updates.status, };
    return await managers.itemManager.updateItem(itemParams);
  };
  contract.getProduct = async function (args, options = defaultOptions) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
    return managers.productManager.getProduct({ ...args, ownerOrganization: contract.userOrganization }, getOptions);
  };
  contract.getProducts = async function (args, options = defaultOptions) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
    return managers.productManager.getProducts(
      { appChainId: contract.chainId, ...args, sort: '-createdDate', ownerOrganization: contract.userOrganization },
      getOptions
    );
  };
  contract.getProductNames = async function (args, options = defaultOptions) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
    return managers.productManager.getProducts(
      { appChainId: contract.chainId, ...args, sort: '-createdDate', notEqualsField: 'ownerOrganization', notEqualsValue: contract.userOrganization },
      getOptions
    );
  };
  contract.getInventory = async function (args, options = defaultOptions) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
    return managers.productManager.getInventory({ ...args, ownerOrganization: contract.userOrganization }, getOptions);
  };
  contract.getInventories = async function (args, options = defaultOptions) {
    const { userAddress, ...restArgs } = args
    const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
    return managers.productManager.getInventories({ appChainId: contract.chainId, ...restArgs, sort: '-createdDate', ownerOrganization: contract.userOrganization }, getOptions);
  };
  // ------------------------------ PRODUCT MANAGER ENDS--------------------------------

  // ---------------------------------Category Manager ---------------------------

  contract.getCategory = async function (args, options = optionsNoChainIds) {
    return managers.categoryManager.get(args, { ...options, org: managers.cirrusOrg, app: mainChainContractName, });
  };

  contract.getCategories = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
    return managers.categoryManager.getAll({ appChainId: contract.chainId, ...args, }, getOptions);
  };

  contract.createCategory = async function (args, options = defaultOptions) {
    const createOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
    const createdDate = Math.floor(Date.now() / 1000);
    return managers.categoryManager.createCategory({ appChainId: contract.chainId, ...args, createdDate, }, createOptions);
  };

  contract.updateCategory = async function (args, options = defaultOptions) {
    const { address: category, updates } = args;
    const createOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, chainIds: [contract.chainId], };
    return managers.categoryManager.updateCategory({ category, ...updates, }, createOptions);
  };

  contract.getSubCategory = async function (args, options = optionsNoChainIds) {
    return managers.categoryManager.getSubCategory(args, { ...options, org: managers.cirrusOrg, app: mainChainContractName, });
  };

  contract.getSubCategories = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
    return managers.categoryManager.getSubCategories({ appChainId: contract.chainId, ...args, }, getOptions);
  };

  contract.createSubCategory = async function (args, options = defaultOptions) {
    const { categoryAddress: category, ...subCategoryArgs } = args;
    const chainOptions = { ...options, chainIds: [contract.chainId] };
    const createdDate = Math.floor(Date.now() / 1000);
    return managers.categoryManager.createSubCategory({ category, createdDate, ...subCategoryArgs }, chainOptions);
  };

  contract.updateSubCategory = async function (args, options = defaultOptions) {
    const { categoryAddress: category, subCategoryAddress: subCategory, updates, } = args;
    const chainOptions = { ...options, chainIds: [contract.chainId] };
    return managers.categoryManager.updateSubCategory({ ...updates, subCategory, category }, chainOptions);
  };

  //TODO: remove this method if not required
  // contract.auditSubCategory = async function (args, options = defaultOptions) {
  //   const { address, chainId } = args;
  //   const auditOptions = {...options, org: managers.cirrusOrg, app: mainChainContractName}
  //   return subCategoryJs.getHistory(rawAdmin, chainId, address, auditOptions);
  // }

  // ---------------------------------Category Manager ends here---------------------------
  /* TODO: TO be removed in future iterations since product/inventory is managed via product manager */
  // contract.createProduct = async function (args, options = defaultOptions) {
  //   const { productArgs, isPublic } = args;
  //   const createOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName }
  //   if (isPublic) {
  //     return productJs.uploadContract(rawAdmin, {
  //       appChainId: contract.chainId,
  //       ...productArgs,
  //     }, createOptions);
  //   } else {
  //     return productChainJs.createProduct(rawAdmin, {
  //       appChainId: contract.chainId,
  //       ...productArgs,
  //     }, createOptions);
  //   }
  // }

  // contract.getProduct = async function (args, options = optionsNoChainIds) {
  //   return productJs.get(rawAdmin, args, { ...options, org: managers.cirrusOrg, app: mainChainContractName })
  // }

  // contract.getProducts = async function (args = {}, options = optionsNoChainIds) {
  //   const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName }
  //   return productJs.getAll(rawAdmin, {
  //     appChainId: contract.chainId,
  //     ...args
  //   }, getOptions)
  // }

  // contract.transferOwnershipProduct = async function (args, options = defaultOptions) {
  //   const { address, chainId, newOwner } = args

  //   const contract = {
  //     name: productJs.contractName,
  //     address: address,
  //   }

  //   const chainOptions = { chainIds: [chainId], ...options }

  //   return productJs.transferOwnership(rawAdmin, contract, chainOptions, newOwner)
  // }

  // contract.auditProduct = async function (args, options = defaultOptions) {
  //   const { address, chainId } = args;
  //   const auditOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName }
  //   return productJs.getHistory(rawAdmin, chainId, address, auditOptions);
  // }

  // contract.getInventory = async function (args, options = optionsNoChainIds) {
  //   return inventoryJs.get(rawAdmin, args, { ...options, org: managers.cirrusOrg, app: mainChainContractName })
  // }

  // contract.createInventory = async function (args, options = defaultOptions) {
  //   const { inventoryArgs, isPublic } = args;
  //   const createOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName }
  //   if (isPublic) {
  //     return inventoryJs.uploadContract(rawAdmin, {
  //       appChainId: contract.chainId,
  //       ...inventoryArgs,
  //     }, createOptions);
  //   } else {
  //     return inventoryChainJs.createInventory(rawAdmin, {
  //       appChainId: contract.chainId,
  //       ...inventoryArgs,
  //     }, createOptions);
  //   }
  // }

  // contract.transferOwnershipInventory = async function (args, options = defaultOptions) {
  // const { address, chainId, newOwner } = args

  //   const contract = {
  //     name: inventoryJs.contractName,
  //     address: address,
  //   }

  //   const chainOptions = { chainIds: [chainId], ...options }

  //   return inventoryJs.transferOwnership(rawAdmin, contract, chainOptions, newOwner)
  // }

  // contract.auditInventory = async function (args, options = defaultOptions) {
  //   const { address, chainId } = args;
  //   const auditOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName }
  //   return inventoryJs.getHistory(rawAdmin, chainId, address, auditOptions);
  // }

  // contract.createItem = async function (args, options = defaultOptions) {
  //   const { itemArgs } = args;
  //   const createOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName }

  //   return itemChainJs.createItem(rawAdmin, {
  //     appChainId: contract.chainId,
  //     ...itemArgs,
  //   }, createOptions);
  // }

  //-----------------------------TO be removed till here-------------------------------

  contract.getMarketplaceInventories = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
    return marketplaceJs.getAll(rawAdmin, { appChainId: contract.chainId, ...args, notEqualsField: 'ownerOrganization', notEqualsValue: contract.userOrganization }, getOptions);
  };

  contract.getTopSellingProducts = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName }
    return marketplaceJs.getTopSellingProducts(rawAdmin, { appChainId: contract.chainId, ...args, notEqualsField: 'ownerOrganization', notEqualsValue: contract.userOrganization }, getOptions)
  }

  contract.getItem = async function (args, options = optionsNoChainIds) {
    return itemJs.get(rawAdmin, args, { ...options, org: managers.cirrusOrg, app: mainChainContractName });
  };

  contract.getItems = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
    return itemJs.getAll(rawAdmin, { appChainId: contract.chainId, ...args, }, getOptions);
  };

  contract.getItemOwnershipHistory = function (args, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
    return itemJs.getAllOwnershipEvents(rawAdmin, { appChainId: contract.chainId, ...args, }, getOptions);
  };

  contract.transferOwnershipItem = async function (args, options = defaultOptions) {
    const { address, chainId, newOwner } = args;
    const contract = { name: itemJs.contractName, address: address, };
    const chainOptions = { chainIds: [chainId], ...options };
    return itemJs.transferOwnership(rawAdmin, contract, chainOptions, newOwner);
  };

  contract.auditItem = async function (args, options = defaultOptions) {
    const { address, chainId } = args;
    const auditOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
    return itemJs.getHistory(rawAdmin, chainId, address, auditOptions);
  };

  contract.updateItem = async function (args, options = defaultOptions) {
    const { address, chainId, updates } = args;
    const contract = { name: itemJs.contractName, address: address, };
    const chainOptions = { chainIds: [chainId], ...options };
    return itemJs.update(rawAdmin, contract, updates, chainOptions);
  };

  contract.getRawMaterials = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
    return managers.itemManager.getRawMaterials({
      appChainId: contract.chainId,
      ...args,
    },
      getOptions
    );
  };

  /* ------------------------ Stripe account connect starts here ------------------------ */
  contract.stripeOnboarding = async function (args, options = defaultOptions) {
    try {
      const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName };
      let userStripeAccount, generatedAccountLink;
      // get user paymentProvider details from cirrus
      const sellerStripeDetails = await paymentProviderJs.get(rawAdmin, { name: SERVICE_PROVIDERS.STRIPE, ownerOrganization: contract.userOrganization, accountDeauthorized: false }, getOptions)

      /*  check if an accountId already exists for the user org */
      if (Object.keys(sellerStripeDetails).length > 0 && sellerStripeDetails.accountLinked) {
        throw new rest.RestError(RestStatus.CONFLICT, "User has already connected their stripe account.")
      }

      if (Object.keys(sellerStripeDetails).length == 0) {
        userStripeAccount = await StripeService.generateStripeAccountId();
        // save generated account id
        const accountDetails = {
          appChainId: contract.chainId, name: SERVICE_PROVIDERS.STRIPE,
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
      const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName };
      // get user paymentProvider details from cirrus
      return paymentProviderJs.get(rawAdmin, { name: SERVICE_PROVIDERS.STRIPE, accountDeauthorized: false, ...args }, getOptions);

    } catch (error) {
      console.error(`${error}`)
      throw new rest.RestError(RestStatus.BAD_REQUEST, `${error.message}`)
    }
  }

  contract.updateStripeOnboardingStatus = async function (args, options = defaultOptions) {
    try {
      // get user paymentProvider details from cirrus
      const { accountId, chargesEnabled, detailsSubmitted, payoutsEnabled, accountDeauthorized, eventTime } = args

      const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName };
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

      const newOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName }
      // TODO

      const inventoriesAddresses = orderList.map(order => order.inventoryId);
      const inventoriesList = await managers.productManager.getInventories({ appChainId: contract.chainId, address: inventoriesAddresses }, newOptions);

      if (inventoriesList.length == 0 || inventoriesList.length != orderList.length) {
        throw new rest.RestError(RestStatus.NOT_FOUND, "Inventory not found")
      }

      const inventoryOrganization = inventoriesList[0].ownerOrganization;
      for (const curr_inventory of inventoriesList) {

        if (curr_inventory.ownerOrganization == contract.userOrganization) {
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
        { ...newOptions, chainIds: [contract.chainId] })

      /*  check if an accountId already exists for the user org */
      if (Object.keys(sellerStripeDetails).length == 0 || !sellerStripeDetails.chargesEnabled || !sellerStripeDetails.detailsSubmitted || !sellerStripeDetails.payoutsEnabled) {
        throw new rest.RestError(RestStatus.CONFLICT, "Seller hasn't activated this payment method")
      }

      const productAddresses = inventoriesList.map(d => d.productId)
      const productList = await managers.productManager.getProducts({ appChainId: contract.chainId, address: productAddresses }, newOptions);

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
        appChainId: contract.chainId,
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
      return managers.paymentManager.get(args, { ...options, org: managers.cirrusOrg, app: mainChainContractName });
    } catch (error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while fetching payment", { message: "Error while fetching payment" })
    }
  };

  contract.getPaymentSession = async function (args, options = defaultOptions) {
    try {
      const newOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName }
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

      const createOptions = { ...optionsNoChainIds, org: managers.cirrusOrg, app: mainChainContractName }

      if (paymentSessionId.length > 1) {
        const order = await orderJs.getAll(rawAdmin, { appChainId: contract.chainId, paymentSessionId }, createOptions);
        if (order.length > 0) {
          throw new rest.RestError(RestStatus.BAD_REQUEST, `Order already placed for payment_id ${paymentSessionId}`)
        }
      }

      // get inventories data
      const inventoryIdArray = orderList.map(order => order.inventoryId);
      const inventories = await managers.productManager.getInventories(
        { appChainId: contract.chainId, address: [...inventoryIdArray] },
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
          appChainId: contract.chainId,
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

        const order = await orderChainJs.createOrder(rawAdmin, orderArgs, createOptions);
        orders.push(order);

        // add orderLine for inventories
        for (const inventoryObject of inventory.data) {

          const shippingCharges = (inventoryObject.pricePerUnit * inventoryObject.quantity) * CHARGES.SHIPPING;
          const tax = (inventoryObject.pricePerUnit * inventoryObject.quantity) * CHARGES.SHIPPING;

          const [status, orderAddress] = await order.addOrderLine({
            orderChainId: order.chainIds[0],
            inventoryOwner: inventoryObject.owner,
            productId: inventoryObject.productId,
            inventoryId: inventoryObject.address,
            quantity: inventoryObject.quantity,
            pricePerUnit: inventoryObject.pricePerUnit,
            shippingCharges,
            tax,
            createdDate
          });

          console.log("status, order.addOrderline", status, "address ======", orderAddress)
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
      const { address, chainId, updates } = args;
      const contract = { name: orderJs.contractName, address: address };

      const chainOptions = { chainIds: [chainId], ...options };
      if (updates.status == ORDER_STATUS.CANCELED) {
        const [statusResponse, inventoryAddresses, quantitiesToUpdate] =
          await orderJs.updateBuyerDetails(rawAdmin, contract, updates, chainOptions);

        const inventories = inventoryAddresses.split(",").slice(0, -1);
        const quantities = quantitiesToUpdate.split(",").slice(0, -1);
        const [status] = await managers.productManager.updateInventoriesQuantities({ inventories, quantities, isReduce: false, });

        return { status };
      }

      return orderJs.updateBuyerDetails(rawAdmin, contract, updates, chainOptions);
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

      console.log("dapp seller order args", args)
      const contract = { name: orderJs.contractName, address: address, };

      const chainOptions = { chainIds: [chainId], ...options };
      if (updates.status == ORDER_STATUS.CANCELED) {
        const [statusResponse, inventoryAddresses, quantitiesToUpdate] =
          await orderJs.updateSellerDetails(rawAdmin, contract, updates, chainOptions);

        const inventories = inventoryAddresses.split(",").slice(0, -1);
        const quantities = quantitiesToUpdate.split(",").slice(0, -1);
        const [status] = await managers.productManager.updateInventoriesQuantities({ inventories, quantities, isReduce: false, });

        return { status };
      } else if (updates.status == ORDER_STATUS.CLOSED) {

        console.log("am I here? ")
        const [statusResponse, inventoryAddresses, quantitiesToUpdate] = await orderJs.updateSellerDetails(rawAdmin, contract, updates, chainOptions);
        console.log("Update Seller status response", statusResponse, "2", inventoryAddresses, "3", quantitiesToUpdate)
        const newOptions = { ...chainOptions, org: managers.cirrusOrg, app: mainChainContractName }

        const orderLines = await orderLineJs.getAll(rawAdmin, {}, newOptions);

        console.log("dapp seller order lines", orderLines, "New Options ========> ", newOptions)
        const orderLinesAddresses = orderLines.map(orderLine => orderLine.address);

        let itemAddresses
        let newOwner = orderLines[0].owner
        let result = []

        for (let orderLineAddress of orderLinesAddresses) {
          const orderLineItems = await orderLineItemJs.getAll(rawAdmin, { orderLineId: orderLineAddress }, newOptions)
          console.log("dapp seller order line items", orderLineItems, "address", orderLineAddress)

          itemAddresses = orderLineItems.map(orderLineItem => orderLineItem.itemId);

          console.log("dapp seller order line itemsAddresses", itemAddresses, "new Owner", newOwner)
          const [status, productId, inventoryId] = await managers.itemManager.transferOwnership({ itemsAddress: itemAddresses, newOwner });
          result.push({ status, productId, inventoryId });
        }
        return result;
      }
      console.log("dapp seller order updates", updates)
      return orderJs.updateSellerDetails(rawAdmin, contract, updates, chainOptions);
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

      const createOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
      const optionsWithChainId = { ...options, org: managers.cirrusOrg, app: mainChainContractName, chainIds: [contract.chainId] };

      const order = orderJs.get(rawAdmin, args, createOptions);
      const orderLines = orderLineJs.getAll(rawAdmin, newArgs, createOptions);

      const response = await Promise.allSettled([order, orderLines]);
      const userContactAddress = await userAddressJs.get(rawAdmin, { address: response[0].value.shippingAddress }, optionsWithChainId);
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
      const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
      return orderJs.getAll(rawAdmin, { appChainId: contract.chainId, ...args, }, getOptions);
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
      const { orderLineId, serialNumber, chainId } = args;
      console.log("dapp order line item args", args)
      const chainOptions = {
        ...options,
        chainIds: [chainId],
        org: managers.cirrusOrg,
        app: mainChainContractName,
      };

      const orderLine = await orderLineJs.get(rawAdmin, { chainId, address: orderLineId }, chainOptions);
      console.log("dapp order line item: orderLine", orderLine)
      const { productId } = orderLine;
        
      const items = await managers.itemManager.getItems(
        {
          productId,
          chainId: contract.chainId,
        },
        chainOptions
      );
        console.log("dapp order line item: item", items, "address", orderLineId)

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
      console.log("dapp order line item: _args", _args)

      const [status, orderLineItems, _items] = await orderLineJs.addOrderLineItems(rawAdmin, _contract, _args, chainOptions);
      const result = orderLineItems.split(",");

      console.log("dapp order line item: result", result, "status", status, "items", _items)
      const [soldStatus] = await managers.itemManager.updateItem({
        itemsAddress: itemsAddresses,
        status: ITEM_STATUS.SOLD,
        comment: "",
      });
      console.log("dapp order line item: soldStatus", soldStatus)
      if (soldStatus !== 200) {
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

      const { chainId } = args;
      const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
      const orderLine = await orderLineJs.get(rawAdmin, { chainId, ...args, }, getOptions);

      const inventory = await contract.getInventory({ address: orderLine.inventoryId, });
      const orderLineItems = await orderLineItemJs.getAll(rawAdmin, { chainId, orderLineId: orderLine.address, }, getOptions);

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
      return orderLineItemJs.get(rawAdmin, args, { ...options, org: managers.cirrusOrg, app: mainChainContractName, chainIds: [args.chainId], });
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while Fetching  the OrderLineItem");
    }
  };


  contract.getOrderLineItems = async function (args = {}, options = optionsNoChainIds) {
    try {
      const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
      return orderLineItemJs.getAll(rawAdmin, { appChainId: contract.chainId, ...args, }, getOptions);
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
      return managers.paymentManager.createUserAddress({ appChainId: contract.chainId, ...args, createdDate: createdDate, });
    } catch (err) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, `Error while adding address: ${JSON.stringify(err)} `);
    }
  };

  contract.getAllUserAddress = async function (args, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName }
    return userAddressJs.getAll(rawAdmin, { appChainId: contract.chainId, ownerOrganization: contract.userOrganization, ...args }, getOptions);
  };


  //-----------------------------Order ends here -------------------------------
  contract.createEventType = async function (args, options = defaultOptions) {
    try {

      const createdDate = Math.floor(Date.now() / 1000);
      return managers.eventTypeManager.createEventType({ appChainId: contract.chainId, ...args, createdDate, });
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while Fetching the OrderLineItems");
    }
  };

  contract.getEventTypes = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
    return managers.eventTypeManager.getAll({ appChainId: contract.chainId, ...args, ownerOrganization: contract.userOrganization }, getOptions);
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
    const getOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
    const eventAddress = [];
    const events = await managers.itemManager.getEvents({ appChainId: contract.chainId, eventBatchId: [...eventBatchId] }, getOptions);

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
    const auditOptions = { ...options, org: managers.cirrusOrg, app: mainChainContractName, };
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
  uploadMainChainContract,
  uploadContract,
  uploadDappChain,
  mainChainContractName,
  bindAddress
};
