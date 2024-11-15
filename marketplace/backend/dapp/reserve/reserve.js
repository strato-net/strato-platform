import { util, rest } from "/blockapps-rest-plus";
import { searchAllWithQueryArgs } from "/helpers/utils";

const contractName = "BlockApps-Mercata-Reserve";

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
  const reserve = await searchAllWithQueryArgs(
    contractName,
    { address: "ea9fbacc92df225e1d8885edad401e7c0343796d" },
    options,
    user
  );
  return reserve.map((reserve) => marshalOut(reserve));
}

/**
 * calculate
 */
async function calculate(user, args, options) {
  const { reserve, ...restArgs } = args;
  const callArgs = {
    contract: { address: reserve },
    method: "previewStake",
    args: util.usc({ ...restArgs }),
  };

  const reponse = await rest.call(user, callArgs, options);
  return reponse[0];
}

/**
 * stake
 */
async function stake(user, args, options) {
  const { reserve, ...restArgs } = args;
  const callArgs = {
    contract: { address: reserve },
    method: "createEscrow",
    args: util.usc({ ...restArgs }),
  };

  const reponse = await rest.call(user, callArgs, options);
  return reponse[0];
}

/**
 * unstake
 */
async function unstake(user, contract, args, options) {
  const callArgs = {
    contract,
    method: "unStake",
    args: util.usc({ ...args }),
  };

  const reponse = await rest.call(user, callArgs, options);
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
