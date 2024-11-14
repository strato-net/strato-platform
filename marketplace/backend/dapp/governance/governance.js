import { util, rest } from "/blockapps-rest-plus";
import { searchAllWithQueryArgs } from "/helpers/utils";

const contractName = "BlockApps-Mercata-Reserve";
const contract = "Reserve";

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
 * Get contract state via cirrus. A proper chainId is typically already provided in options.
 * @param args Lookup with an address or uniqueEventID.
 * @returns Contract state in cirrus
 */
async function get(user, options) {
  const governance = await searchAllWithQueryArgs(
    contractName,
    { creator: "BlockApps" },
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
  const { governance, ...restArgs } = args;
  const contractObj = { name: contract, address: governance };
  const callArgs = {
    contract: contractObj,
    method: "previewStake",
    args: util.usc({ ...restArgs }),
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
  const { governance, ...restArgs } = args;
  const contract = { name: contractName, address: governance };
  const callArgs = {
    contract,
    method: "createEscrow",
    args: util.usc({ ...restArgs }),
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
async function unstake(user, contract,  args, options) {
  const callArgs = {
    contract,
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
  get,
  marshalIn,
  marshalOut,
  calculate,
  stake,
  unstake,
};
