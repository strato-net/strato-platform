import { util, rest, importer } from "/blockapps-rest-plus";
import config from "/load.config";
import RestStatus from "http-status-codes";
import {
  setSearchQueryOptions,
  searchOne,
  searchAll,
  searchAllWithQueryArgs,
  setSearchQueryOptionsPrime,
} from "/helpers/utils";

import dayjs from "dayjs";
import constants from "../../helpers/constants";

const contractName = "Offer";
const paymentServiceContractName = "TokenPaymentService";

/**
 * Upload a new Offer
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of Offer's constructor
 * @param options  deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 * @returns Contract object
 * */

async function createOffer(user, _constructorArgs, options) {
  const constructorArgs = marshalIn(_constructorArgs);
  console.log("Checking createOffer1111 ===> ", user, constructorArgs, options);
  const contract = { name: paymentServiceContractName, address: options.contractAddress };
  const contractArgs = {
    contract,
    args: util.usc(constructorArgs),
  };

  const copyOfOptions = {
    ...options,
    history: contractName,
  };
  console.log("Checking createOffer2222 ===> ", user, contractArgs, copyOfOptions);
  const createOffer = await rest.call(user, contractArgs, copyOfOptions);
  return createOffer;
}

async function getHistory(user, chainId, address, options) {
  const contractArgs = {
    name: `history@${contractName}`,
  };

  const copyOfOptions = {
    ...options,
    query: {
      address: `eq.${address}`,
    },
    chainIds: [chainId],
  };

  const history = await rest.search(user, contractArgs, copyOfOptions);
  return;
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
 * Augment contract arguments before they are used to post a contract.
 * Its counterpart is {@link marshalOut `marshalOut`}.
 *
 * As our arguments come into the offer contract they first pass through `marshalIn` and
 * when we retrieve contract state they pass through {@link marshalOut `marshalOut`}.
 *
 * (A mathematical analogy: `marshalIn` and {@link marshalOut `marshalOut`} form something like a
 * homomorphism)
 *
 * @param args - Contract state
 */
function marshalIn(_args) {
  const args = { ..._args };
  return args;
}

/**
 * Augment contract state before it is used.
 * Its counterpart is {@link marshalIn `marshalIn`}.
 *
 * As our arguments come into the offer contract they first pass through `marshalIn` and
 * when we retrieve contract state they pass through {@link marshalOut `marshalOut`}.
 *
 * (A mathematical analogy: `marshalIn` and {@link marshalOut `marshalOut`} form something like a
 * homomorphism)
 *
 * @param args - Contract state
 */
function marshalOut(_args) {
  const args = { ..._args };
  return args;
}

/**
 * Bind the contract to the API
 * @param user User token (typically an admin)
 * @param contract Contract object
 * @param options deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 * @returns Contract object
 */

function bind(user, _contract, options) {
  const contract = { ..._contract };

  contract.get = async (args) => get(user, args, options);
  contract.getState = async () => getState(user, contract, options);
  contract.getHistory = async (args, options = contractOptions) =>
    getHistory(user, chainId, args, options);
  contract.chainIds = options.chainIds;

  return contract;
}

async function get(user, args, defaultOptions) {
  const options = { ...defaultOptions, org: 'BlockApps', app: 'Mercata' }

  const contractArgs = {
    name: contractName,
    address: args.address,
  };

  const offer = await searchOne(user, contractArgs, options);
  return offer;
}

async function getAll(user, args = {}, defaultOptions) {
  const options = { ...defaultOptions, org: 'BlockApps', app: 'Mercata' }

  const offers = await searchAllWithQueryArgs(
    contractName,
    args,
    options,
    user
  );
  return offers;
}

async function updateOffer(user, args, options) {
  const callArgs = {
    name: contractName,
    address: args.address,
    args: marshalIn(args),
  };

  const updatedOffer = await rest.call(user, callArgs, options);
  return updatedOffer;
}

async function acceptOffer(user, args, options) {
  const callArgs = {
    name: contractName,
    address: args.address,
  };

  const acceptedOffer = await rest.call(user, callArgs, options);
  return acceptedOffer;
}

async function rejectOffer(user, args, options) {
  const callArgs = {
    name: contractName,
    address: args.address,
  };

  const rejectedOffer = await rest.call(user, callArgs, options);
  return rejectedOffer;
}

async function cancelOffer(user, args, options) {
  const callArgs = {
    name: contractName,
    address: args.address,
  };

  const canceledOffer = await rest.call(user, callArgs, options);
  return canceledOffer;
}

// This is going to have to be offers that the user has received. 
// We will have to get all the offers for the user and make sure the status is pending
// Additionally we will then sort the offers by the item. So group each offer by an item and then sort by date. 
// This will allow the user to see all the offers they have received for a specific item.
async function getIncomingOffers(user, args, options) {
  const offers = await rest.searchAllWithQueryArgs(
    contractName,
    args,
    options,
    user
  );
  return offers;
}

// This is going to have to be offers that the user has sent.
// We will have to get all the offers for the user and make sure the status is pending
async function getOutgoingOffers(user, args, options) {
  const offers = await rest.searchAllWithQueryArgs(
    contractName,
    args,
    options,
    user
  );
  return offers;
}

// We may not need these functions below, will leave for now.
async function getAcceptedOffers(user, args, options) {
  const offers = await rest.searchAllWithQueryArgs(
    contractName,
    args,
    options,
    user
  );
  return offers;
}

async function getRejectedOffers(user, args, options) {
  const offers = await rest.searchAllWithQueryArgs(
    contractName,
    args,
    options,
    user
  );
  return offers;
}

async function getCancelledOffers(user, args, options) {
  const offers = await rest.searchAllWithQueryArgs(
    contractName,
    args,
    options,
    user
  );
  return offers;
}

export default {
  createOffer,
  get,
  getAll,
  updateOffer,
  acceptOffer,
  rejectOffer,
  cancelOffer,
  getIncomingOffers,
  getOutgoingOffers,
  getAcceptedOffers,
  getRejectedOffers,
  getCancelledOffers,
  marshalIn,
  marshalOut,
  bind,
  getHistory,
  getState,
};
