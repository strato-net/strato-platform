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

import reviewJs from "./review";

const contractName = "ReviewManager_0_1";
const contractFilename = `${util.cwd}/dapp/reviews/contracts/ReviewManager.sol`;

/**
 * Upload a new review manager
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of review's constructor
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
 * As our arguments come into the reviewManager contract they first pass through {@link marshalIn `marshalIn`}
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
 * @param address Address of the Review contract
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
  contract.getReview = async (args, _options = defaultOptions) =>
    getReview(user, args, _options);
  contract.getReviews = async (args, _options = defaultOptions) =>
    getReviews(user, args, _options);
  contract.createReview = async (args) =>
    createReview(user, contract, args, options);
  contract.updateReview = async (args) =>
    updateReview(user, contract, args, options);
  contract.deleteReview = async (args) =>
    deleteReview(user, contract, args, options);
  return contract;
}

/**
 * get the reviews
 */
async function getReview(user, args, options) {
  console.log('review-manager getReview', args)
  return reviewJs.get(user, args, options);
}

async function getReviews(user, args, options) {
  return reviewJs.getAll(user, args, options);
}

// * Add the reviews
async function createReview(admin, contract, _args, baseOptions) {
  console.log('review-manager createReview', _args)
  const callArgs = {
    contract,
    method: "createReview",
    args: util.usc({
      ..._args,
    }),
  };
  const options = {
    ...baseOptions,
    history: [contractName],
  };

  const [restStatus, reviewAddress] = await rest.call(
    admin,
    callArgs,
    options
  );

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, reviewAddress];
}

async function updateReview(admin, contract, _args, baseOptions) {
  const callArgs = {
    contract,
    method: "updateReview",
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

/**
 * Delete review
 */
async function deleteReview(admin, contract, _args, baseOptions) {
  const callArgs = {
    contract,
    method: "deleteReview",
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
  createReview,
  updateReview,
  deleteReview,
};