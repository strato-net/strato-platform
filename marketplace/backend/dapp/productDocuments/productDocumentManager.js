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

import productDocumentJs from "./productDocument";

const contractName = "ProductDocumentManager";
const contractFilename = `${util.cwd}/dapp/productDocuments/contracts/ProductDocumentManager.sol`;

/**
 * Upload a new productDocument manager
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of productDocument's constructor
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
  contract.getProductDocument = async (args, _options = defaultOptions) =>
    getProductDocument(user, args, _options);
  contract.getProductDocuments = async (args, _options = defaultOptions) =>
    getProductDocuments(user, args, _options);
  contract.createProductDocument = async (args) =>
    createProductDocument(user, contract, args, options);
  contract.deleteProductDocument = async (args) =>
    deleteProductDocument(user, contract, args, options);
  return contract;
}

/**
 * get the productDocuments
 */
async function getProductDocument(user, args, options) {
  return productDocumentJs.get(user, args, options);
}

async function getProductDocuments(user, args, options) {
  return productDocumentJs.getAll(user, args, options);
}

// * Add the productDocuments
async function createProductDocument(admin, contract, _args, baseOptions) {
  console.log('document-manager document', _args)
  const callArgs = {
    contract,
    method: "createProductDocument",
    args: util.usc({
      ..._args,
    }),
  };
  const options = {
    ...baseOptions,
    history: [contractName],
  };

  const [restStatus, productDocumentAddress] = await rest.call(
    admin,
    callArgs,
    options
  );

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });
console.log("productDocumentAddress++++", productDocumentAddress)
  return [restStatus, productDocumentAddress];
}

/**
 * Delete productDocuments
 */
async function deleteProductDocument(admin, contract, _args, baseOptions) {
  const callArgs = {
    contract,
    method: "deleteProductDocument",
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
 * Get contract state in bloc.
 * @deprecated Use {@link get `get`} instead.
 */
async function getState(user, contract, options) {
  const state = await rest.getState(user, contract, options);
  return marshalOut(state);
}

export default {
  bindAddress,
  uploadContract,
  contractName,
  contractFilename,
  marshalOut,
  createProductDocument,
  getProductDocument,
  getProductDocuments,
  deleteProductDocument,
};