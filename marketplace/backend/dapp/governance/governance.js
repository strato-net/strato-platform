import { util, rest } from "/blockapps-rest-plus";
import { searchAllWithQueryArgs } from "/helpers/utils";

const contractName = "Governance";

/**
 * Augment contract arguments before they are used to post a contract.
 * Its counterpart is {@link marshalOut `marshalOut`}.
 *
 * As our arguments come into the payment contract they first pass through `marshalIn` and
 * when we retrieve contract state they pass through {@link marshalOut `marshalOut`}.
 *
 * (A mathematical analogy: `marshalIn` and {@link marshalOut `marshalOut`} form something like a
 * homomorphism)
 * @param args - Contract state
 */

function marshalIn(_args) {
  const defaultArgs = {
    paymentSessionId: "",
    paymentService: "",
    paymentStatus: "",
    sessionStatus: "",
    amount: "",
    expiresAt: 0,
    createdDate: 0,
    sellerAccountId: "",
  };

  const args = {
    ...defaultArgs,
    ..._args,
  };
  return args;
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
  return history;
}

/**
 * Augment returned contract state before it is returned.
 * Its counterpart is {@link marshalIn `marshalIn`}.
 *
 * As our arguments come into the payment contract they first pass through {@link marshalIn `marshalIn`}
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
 * Bind functions relevant for payment to the _contract object.
 * @param user User token
 * @param _contract Contract object from `rest.createContract()` etc.
 * @param options Payment deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */

function bind(user, _contract, options) {
  const contract = { ..._contract };

  contract.get = async (args = { address: contract.address }) =>
    get(user, args, options);
  contract.getState = async () => getState(user, contract, options);
  contract.getHistory = async (args, options = contractOptions) =>
    getHistory(user, chainId, args, options);
  contract.chainIds = options.chainIds;

  return contract;
}

/**
 * Bind an existing Payment contract to a new user token. Useful for having multiple users test
 * the same contract.
 * @example <caption>Create an admin and user bound to the same new payment contract.</caption>
 * const adminBoundContract = uploadContract(adminToken, args, options);
 * const userBoundContract = bindAddress(userToken, adminBoundContract.address, options);
 * @param user User token
 * @param address Address of the Payment contract
 * @param options Payment deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */
function bindAddress(user, address, options) {
  const contract = {
    name: contractName,
    address,
  };
  return bind(user, contract, options);
}

/**
 * Get contract state via cirrus. A proper chainId is typically already provided in options.
 * @param args Lookup with an address or uniqueEventID.
 * @returns Contract state in cirrus
 */
async function get(user, options) {
  const governance = await searchAllWithQueryArgs(
    contractName,
    { isActive: true, creator: "BlockApps" },
    options,
    user
  );
  return governance.map((governance) => marshalOut(governance));
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
 * calculate
 */
async function calculate(user, args, options) {
  const callArgs = {
    contract: args.contract,
    method: "calculate",
    args: util.usc({ ...args }),
  };

  const reponse = await rest.call(user, callArgs, options);

  if (parseInt(reponse, 10) !== RestStatus.OK) {
    throw new rest.RestError(
      reponse,
      "Failed to calculate stake preview.",
      { callArgs }
    );
  }

  return reponse;
}

/**
 * stake
 */
async function stake(user, args, options) {
  const callArgs = {
    contract: args.contract,
    method: "stake",
    args: util.usc({ ...args }),
  };

  const reponse = await rest.call(user, callArgs, options);

  if (parseInt(reponse, 10) !== RestStatus.OK) {
    throw new rest.RestError(
      reponse,
      "Failed to stake.",
      { callArgs }
    );
  }

  return reponse;
}

/**
 * unstake
 */
async function unstake(user, args, options) {
  const callArgs = {
    contract: args.contract,
    method: "unstake",
    args: util.usc({ ...args }),
  };

  const reponse = await rest.call(user, callArgs, options);

  if (parseInt(reponse, 10) !== RestStatus.OK) {
    throw new rest.RestError(
      reponse,
      "Failed to unstake.",
      { callArgs }
    );
  }

  return reponse;
}

export default {
  contractName,
  bindAddress,
  get,
  marshalIn,
  marshalOut,
  getHistory,
  calculate,
  stake,
  unstake,
};
