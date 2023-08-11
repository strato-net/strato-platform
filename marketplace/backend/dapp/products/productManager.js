import { util, rest, importer } from "/blockapps-rest-plus";
import config from "/load.config";
import RestStatus from "http-status-codes";
import {
  setSearchQueryOptions,
  searchOne,
  searchAll,
  searchAllWithQueryArgs,
} from "/helpers/utils";
import dayjs from "dayjs";

import productJs from "./product";
import inventoryJs from "./inventory";
import propertyJs from "./property";

const contractName = "ProductManager";
const contractFilename = `${util.cwd}/dapp/products/contracts/ProductManager.sol`;

/**
 * Upload a new Product manager
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of Inventory's constructor
 * @param options  deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 * @returns Contract object
 * */
async function uploadContract(user, _constructorArgs, options) {
  const contractArgs = {
    name: contractName,
    source: await importer.combine(contractFilename),
    args: util.usc(_constructorArgs),
  };

  let error = [];

  if (error.length) {
    throw new Error(error.join("\n"));
  }

  const copyOfOptions = {
    ...options,
    history: contractName,
  };

  const contract = await rest.createContract(user, contractArgs, copyOfOptions);
  contract.src = "removed";

  return bind(user, contract, copyOfOptions);
}

/**
 * Augment returned contract state before it is returned.
 * Its counterpart is {@link marshalIn `marshalIn`}.
 *
 * As our arguments come into the productManager contract they first pass through {@link marshalIn `marshalIn`}
 * and when we retrieve contract state they pass through `marshalOut`.
 *
 * (A mathematical analogy: {@link marshalIn `marshalIn`} and `marshalOut` form something like a
 * homomorphism)
 * @param _args - Contract state
 */
function marshalOut(_args) {
  const args = {
    ..._args,
  };
  return args;
}

/**
 * Bind functions relevant for inventory to the _contract object.
 * @param user User token
 * @param _contract Contract object from `rest.createContract()` etc.
 * @param options Inventory deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */

/**
 * Bind an existing Product contract to a new user token. Useful for having multiple users test
 * the same contract.
 * @example <caption>Create an admin and user bound to the same new product contract.</caption>
 * const adminBoundContract = uploadContract(adminToken, args, options);
 * const userBoundContract = bindAddress(userToken, adminBoundContract.address, options);
 * @param user User token
 * @param address Address of the Product contract
 * @param options Product deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */
function bindAddress(user, address, options) {
  const contract = {
    name: contractName,
    address,
  };
  return bind(user, contract, options);
}

function bind(user, _contract, options) {
  const contract = { ..._contract };
  const defaultOptions = {
    ...options,
  };
  contract.getState = async () => getState(user, contract, options);
  contract.getProduct = async (args, _options = defaultOptions) =>
    getProduct(user, args, _options);
  contract.getProducts = async (args, _options = defaultOptions) =>
    getProducts(user, args, _options);
  contract.getInventory = async (args, _options = defaultOptions) =>
    getInventory(user, contract, args, _options);
  contract.getInventories = async (args, _options = defaultOptions) =>
    getInventories(user, contract, args, _options);
  contract.updateProduct = async (args) =>
    updateProduct(user, contract, args, options);
  contract.createProduct = async (args) =>
    createProduct(user, contract, args, options);
  contract.createInventory = async (args) =>
    createInventory(user, contract, args, options);
  contract.updateInventory = async (args) =>
    updateInventory(user, contract, args, options);
  contract.deleteProduct = async (args) =>
    deleteProduct(user, contract, args, options);
  contract.updateInventoriesQuantities = async (args) =>
    updateInventoriesQuantities(user, contract, args, options);
  /* PROPERTY BINDINGS */
  contract.getProperty = async (args, _options = defaultOptions) =>
    getProperty(user, args, _options);
  contract.getProperties = async (args, _options = defaultOptions) =>
    getProperties(user, args, _options);
  contract.createProperty = async (args) =>
    createProperty(user, contract, args, options);
  contract.updateProperty = async (args) =>
    updateProperty(user, contract, args, options);
  return contract;
}

// * Add the product
async function createProduct(admin, contract, _args, baseOptions) {
  const callArgs = {
    contract,
    method: "addProduct",
    args: util.usc({
      ..._args,
    }),
  };
  const options = {
    ...baseOptions,
    history: [contractName],
  };

  const [restStatus, productAddress] = await rest.call(
    admin,
    callArgs,
    options
  );

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, productAddress];
}

/**
 * Update Product
 */
async function updateProduct(admin, contract, _args, baseOptions) {
  _args = { productAddress: _args.productAddress, ..._args.updates };

  const scheme = Object.keys(_args).reduce((agg, key) => {
    const base = 1;
    switch (key) {
      case "description":
        return agg | (base << 0);
      case "imageKey":
        return agg | (base << 1);
      case "isActive":
        return agg | (base << 2);
      case "userUniqueProductCode":
        return agg | (base << 3);
      default:
        return agg;
    }
  }, 0);

  const callArgs = {
    contract,
    method: "updateProduct",
    args: util.usc({
      scheme,
      ..._args,
    }),
  };

  const options = {
    ...baseOptions,
    history: [contractName],
  };

  const [restStatus] = await rest.call(
    admin,
    callArgs,
    options
  );

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus];
}

/**
 * Delete Product
 */
async function deleteProduct(admin, contract, _args, baseOptions) {
  const callArgs = {
    contract,
    method: "deleteProduct",
    args: util.usc({
      ..._args,
    }),
  };

  const options = {
    ...baseOptions,
    history: [contractName],
  };

  const [restStatus, deletedStatus] = await rest.call(admin, callArgs, options);

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, deletedStatus];
}

/**
 * Add the inventory for a product
 */
async function createInventory(admin, contract, _args, baseOptions) {
  const callArgs = {
    contract,
    method: "addInventory",
    args: util.usc({
      ..._args,
    }),
  };
  const options = {
    ...baseOptions,
    history: [contractName],
  };

  const [restStatus, inventoryAddress] = await rest.call(
    admin,
    callArgs,
    options
  );

  if (restStatus == 409)
    throw new rest.RestError(RestStatus.CONFLICT, { message: "repeated serial numbers found" });

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, inventoryAddress];
}

/**
 * Update the inventory for a product
 */
async function updateInventory(admin, contract, _args, baseOptions) {
  _args = {
    productAddress: _args.productAddress,
    inventory: _args.inventory,
    ..._args.updates,
  };
  const scheme = Object.keys(_args).reduce((agg, key) => {
    const base = 1;
    switch (key) {
      case "pricePerUnit":
        return agg | (base << 0);
      case "status":
        return agg | (base << 1);
      default:
        return agg;
    }
  }, 0);
  const callArgs = {
    contract,
    method: "updateInventory",
    args: util.usc({
      scheme,
      ..._args,
    }),
  };

  const options = {
    ...baseOptions,
    history: [contractName],
  };
  const [restStatus, inventoryAddress] = await rest.call(
    admin,
    callArgs,
    options
  );

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, inventoryAddress];
}

/**
 * Get contract state in bloc.
 * @deprecated Use {@link get `get`} instead.
 */
async function getState(user, contract, options) {
  const state = await rest.getState(user, contract, options);
  return marshalOut(state);
}

/**
 * get the product details
 */
async function getProduct(user, args, options) {
  return productJs.get(user, args, options);
}

/**
 * get all the product details
 */
async function getProducts(user, args, options) {
  return productJs.getAll(user, args, options);
}

/**
 * get the inventory with product details
 */
async function getInventory(user, contract, args, options) {
  try {
    const inventory = await inventoryJs.get(user, args, options);
    if (!inventory) {
      throw new Error("product Id should be defined in inventory");
    }
    const product = await contract.getProduct(
      { address: inventory.productId },
      options
    );
    return {
      ...product,
      ...inventory,
    };
  } catch (error) {
    throw error;
  }
}

/**
 * get all the inventories with product details
 */
async function getInventories(admin, contract, args = {}, options) {
  try {
    const inventories = await inventoryJs.getAll(admin, args, options);
    const productIds = [
      ...new Set(inventories.map((inventory) => inventory.productId)),
    ];
    const products = await contract.getProducts(
      { address: [...productIds] },
      options
    );
    const inventoriesWithProductInfo = inventories
      .filter((inventory) => productIds.includes(inventory.productId))
      .map((inventory) => {
        const { category, subCategory, ...newInventory } = inventory;
        return {
          ...products.find((product) => product.address == inventory.productId),
          ...newInventory,
        };
      });
    return inventoriesWithProductInfo;
  } catch (error) {
    throw error;
  }
}

async function updateInventoriesQuantities(admin, contract, _args, baseOptions) {

  const callArgs = {
    contract,
    method: "updateInventoriesQuantities",
    args: util.usc({
      ..._args,
    }),
  };

  const options = {
    ...baseOptions,
    history: [contractName],
  };
  const [restStatus] = await rest.call(
    admin,
    callArgs,
    options
  );

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus];
}

/* PROPERTY FUNCTIONS */
async function getProperty(user, args, options) {
  return propertyJs.get(user, args, options);
}

async function getProperties(user, args, options) {
  return propertyJs.getAll(user, args, options);
}

async function createProperty(admin, contract, _args, baseOptions) {
  const callArgs = {
    contract,
    method: "addProperty",
    args: util.usc({
      ..._args,
    }),
  };
  const options = {
    ...baseOptions,
    history: [contractName],
  };

  const [restStatus, propertyAddress] = await rest.call(
    admin,
    callArgs,
    options
  );

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, propertyAddress];
}

async function updateProperty(admin, contract, _args, baseOptions) {
  _args = { propertyAddress: _args.propertyAddress, ..._args.updates }; //need to update

  const scheme = Object.keys(_args).reduce((agg, key) => {
    const base = 1;
    switch (key) {
      case "listPrice":
        return agg | (base << 0);
      case "streetNumber":
        return agg | (base << 1);
      case "streetName":
        return agg | (base << 2);
      case "unitNumber":
        return agg | (base << 3);
      case "postalCity":
        return agg | (base << 4);
      case "stateOrProvince":
        return agg | (base << 5);
      case "postalcode":
        return agg | (base << 6);
      case "bathroomsTotalInteger":
        return agg | (base << 7);
      case "bedroomsTotal":
        return agg | (base << 8);
      case "standardStatus":
        return agg | (base << 9);
      case "lotSizeArea":
        return agg | (base << 10);
      case "lotSizeUnits":
        return agg | (base << 11);
      case "livingArea":
        return agg | (base << 12);
      case "livingAreaUnits":
        return agg | (base << 13);
      case "latitude":
        return agg | (base << 14);
      case "longitude":
        return agg | (base << 15);
      case "numberOfUnitsTotal":
        return agg | (base << 16);
      // Appliances
      case "dishwasher":
        return agg | (base << 17);
      case "dryer":
        return agg | (base << 18);
      case "freezer":
        return agg | (base << 19);
      case "garbageDisposal":
        return agg | (base << 20);
      case "microwave":
        return agg | (base << 21);
      case "ovenOrRange":
        return agg | (base << 22);
      case "refrigerator":
        return agg | (base << 23);
      case "washer":
        return agg | (base << 24);
      case "waterHeater":
        return agg | (base << 25);
      // Cooling
      case "centralAir":
        return agg | (base << 26);
      case "evaporative":
        return agg | (base << 27);
      case "geoThermal":
        return agg | (base << 28);
      case "refrigeration":
        return agg | (base << 29);
      case "solar":
        return agg | (base << 30);
      case "wallUnit":
        return agg | (base << 31);
      // Heating
      case "baseboard":
        return agg | (base << 32);
      case "forceAir":
        return agg | (base << 33);
      case "geoThermalHeat":
        return agg | (base << 34);
      case "heatPump":
        return agg | (base << 35);
      case "hotWater":
        return agg | (base << 36);
      case "radiant":
        return agg | (base << 37);
      case "solarHeat":
        return agg | (base << 38);
      case "steam":
        return agg | (base << 39);
      // Flooring
      case "carpet":
        return agg | (base << 40);
      case "concrete":
        return agg | (base << 41);
      case "hardwood":
        return agg | (base << 42);
      case "laminate":
        return agg | (base << 43);
      case "linoleumVinyl":
        return agg | (base << 44);
      case "slate":
        return agg | (base << 45);
      case "softwood":
        return agg | (base << 46);
      case "tile":
        return agg | (base << 47);
      // Parking
      case "carport":
        return agg | (base << 48);
      case "garage":
        return agg | (base << 49);
      case "offStreet":
        return agg | (base << 50);
      case "onStreet":
        return agg | (base << 51);
      // Interior Features
      case "attic":
        return agg | (base << 52);
      case "cableReady":
        return agg | (base << 53);
      case "ceilingFan":
        return agg | (base << 54);
      case "doublePaneWindows":
        return agg | (base << 55);
      case "elevator":
        return agg | (base << 56);
      case "fireplace":
        return agg | (base << 57);
      case "flooring":
        return agg | (base << 58);
      case "furnished":
        return agg | (base << 59);
      case "jettedTub":
        return agg | (base << 60);
      case "securitySystem":
        return agg | (base << 61);
      case "vaultedCeiling":
        return agg | (base << 62);
      case "skylight":
        return agg | (base << 63);
      case "wetBar":
        return agg | (base << 64);
      // Exterior Features
      case "barbecueArea":
        return agg | (base << 65);
      case "deck":
        return agg | (base << 66);
      case "dock":
        return agg | (base << 67);
      case "fence":
        return agg | (base << 68);
      case "garden":
        return agg | (base << 69);
      case "hotTubOrSpa":
        return agg | (base << 70);
      case "lawn":
        return agg | (base << 71);
      case "patio":
        return agg | (base << 72);
      case "pond":
        return agg | (base << 73);
      case "pool":
        return agg | (base << 74);
      case "porch":
        return agg | (base << 75);
      case "rvParking":
        return agg | (base << 76);
      case "sauna":
        return agg | (base << 77);
      case "sprinklerSystem":
        return agg | (base << 78);
      case "waterFront":
        return agg | (base << 79);
      default:
        return agg;
    }
  }, 0);

  const callArgs = {
    contract,
    method: "updateProperty",
    args: util.usc({
      scheme,
      ..._args,
    }),
  };

  const options = {
    ...baseOptions,
    history: [contractName],
  };

  const [restStatus] = await rest.call(
    admin,
    callArgs,
    options
  );

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus];
}

export default {
  bindAddress,
  uploadContract,
  contractName,
  contractFilename,
  marshalOut,
  createProduct,
  updateProduct,
  deleteProduct,
  createInventory,
  updateInventory,
  updateInventoriesQuantities,
  createProperty,
  updateProperty,
};
