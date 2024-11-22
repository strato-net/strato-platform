import { rest, util } from 'blockapps-rest';
import {
  searchAllWithQueryArgs,
  searchAll,
  setSearchQueryOptions,
} from '/helpers/utils';
import constants from '/helpers/constants';

const contractName = 'ERC20Dapp';

/**
 * Augment contract arguments before they are used to post a contract.
 * Its counterpart is {@link marshalOut `marshalOut`}.
 *
 * As our arguments come into the inventory contract they first pass through `marshalIn` and
 * when we retrieve contract state they pass through {@link marshalOut `marshalOut`}.
 *
 * (A mathematical analogy: `marshalIn` and {@link marshalOut `marshalOut`} form something like a
 * homomorphism)
 * @param args - Contract state
 */
function marshalIn(_args) {
  const defaultArgs = {
    quantity: 0,
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
 * As our arguments come into the inventory contract they first pass through {@link marshalIn `marshalIn`}
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

async function getStratsBalance(admin, args = {}, options) {
  const stratsBalance = await searchAllWithQueryArgs(
    `ERC20Dapp-balances`,
    args,
    options,
    admin
  );
  if (stratsBalance.length > 0) {
    return parseFloat(stratsBalance[0].value / 100).toFixed(2);
  }
  return 0;
}

async function getStratsTransactionHistory(admin, args = {}, options) {
  const { userAddress } = args;
  const baseFilters = [
    { key: ['_to', '_from'], value: userAddress, predicate: 'or' },
  ];

  const searchArgs = setSearchQueryOptions(args, [...baseFilters]);

  const transactionHistory = await searchAll(
    `ERC20Dapp.Receipt`,
    searchArgs,
    options,
    admin
  );

  return transactionHistory;
}

async function transferStrats(admin, args, options = defaultOptions) {
  const address = getStratsAddress();
  const contract = {
    name: contractName,
    address,
  };
  const callArgs = {
    contract,
    method: 'transfer',
    args: util.usc(args),
  };
  return rest.call(admin, callArgs, options);
}

function getStratsAddress() {
  if (process.env.networkID === constants.prodNetworkId) {
    return constants.prodStratsAddress;
  } else if (process.env.networkID === constants.testnetNetworkId) {
    return constants.testnetStratsAddress;
  } else {
    return constants.prodStratsAddress;
  }
}

export default {
  getStratsBalance,
  getStratsTransactionHistory,
  transferStrats,
  getStratsAddress,
  marshalIn,
  marshalOut,
};
