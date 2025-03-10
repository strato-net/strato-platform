import { util, rest, importer } from '/blockapps-rest-plus';
import { waitForAddress } from '/helpers/utils';
import constants from '../../helpers/constants';

const contractName = 'Tokens';
const contractFilename = `${util.cwd}/dapp/items/contracts/Tokens.sol`;

/**
 * Uploads a new Tokens item
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of Item's constructor
 * @param options  deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 * @returns Contract object
 * */
async function uploadContract(user, _constructorArgs, options) {
  const constructorArgs = marshalIn(_constructorArgs);

  const contractArgs = {
    name: contractName,
    source: await importer.combine(contractFilename),
    args: util.usc(constructorArgs),
  };

  let error = [];

  if (error.length) {
    throw new Error(error.join('\n'));
  }

  const copyOfOptions = {
    ...options,
    history: contractName,
  };

  const contract = await rest.createContract(user, contractArgs, copyOfOptions);
  contract.src = 'removed';

  const searchOptions = {
    ...options,
    org: constants.blockAppsOrg,
    query: {
      address: `eq.${contract.address}`,
    },
  };

  await waitForAddress(user, { name: constants.assetTableName }, searchOptions);

  return bind(user, contract, copyOfOptions);
}

/**
 * Augment contract arguments before they are used to post a contract.
 * Its counterpart is {@link marshalOut `marshalOut`}.
 *
 * As our arguments come into the item contract they first pass through `marshalIn` and
 * when we retrieve contract state they pass through {@link marshalOut `marshalOut`}.
 *
 * (A mathematical analogy: `marshalIn` and {@link marshalOut `marshalOut`} form something like a
 * homomorphism)
 * @param args - Contract state
 */
function marshalIn(_args) {
  const defaultArgs = {};

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
 * As our arguments come into the item contract they first pass through {@link marshalIn `marshalIn`}
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
 * Bind functions relevant for item to the _contract object.
 * @param user User token
 * @param _contract Contract object from `rest.createContract()` etc.
 * @param options Item deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */

function bind(user, _contract, options) {
  const contract = { ..._contract };

  contract.get = async (args = { address: contract.address }) =>
    get(user, args, options);
  contract.getState = async () => getState(user, contract, options);
  contract.transferOwnership = async (newOwner) =>
    transferOwnership(user, contract, options, newOwner);
  contract.getHistory = async (args, options = contractOptions) =>
    getHistory(user, chainId, args, options);
  contract.chainIds = options.chainIds;

  return contract;
}

/**
 * Bind an existing Tokens contract to a new user token. Useful for having multiple users test
 * the same contract.
 * @example <caption>Create an admin and user bound to the same new item contract.</caption>
 * const adminBoundContract = createArt(adminToken, args, options);
 * const userBoundContract = bindAddress(userToken, adminBoundContract.address, options);
 * @param user User token
 * @param address Address of the Item contract
 * @param options Item deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */
function bindAddress(user, address, options) {
  const contract = {
    name: contractName,
    address,
  };
  return bind(user, contract, options);
}

async function addHash(user, args, options) {
  const CREATOR = 'in.(BlockApps,mercata_usdst)';
  const IS_ACTIVE = 'eq.true';
  const { txHash, userAddress, amount, tokenName } = args;
  const contractName = 'MercataETHBridge';
  const mercataETHBridgeSearchOptions = {
    ...options,
    query: {
      creator: CREATOR,
      isActive: IS_ACTIVE,
      ['data->>isMint']: 'eq.True',
      ['data->>name']: `ilike.%${tokenName}%`,
    },
  };

  const ethBridge = await rest.search(
    user,
    { name: 'BlockApps-Mercata-MercataETHBridge' },
    mercataETHBridgeSearchOptions
  );

  if (!ethBridge || ethBridge.length === 0) {
    throw new Error('No active ethBridge found for the given address');
  }

  const callArgs = {
    contract: {
      name: contractName,
      address: ethBridge[0].address,
    },
    method: 'addHash',
    args: util.usc({ userAddress, txHash, amount }),
  };

  return rest.call(user, callArgs, options);
}

async function burnETHST(user, args, options) {
  const { ethstAddresses, quantity, baseAddress, tokenAssetRootAddress } = args;
  const contractName = 'MercataETHBridge';

  const callArgs = {
    contract: {
      name: contractName,
      address: tokenAssetRootAddress,
    },
    method: 'burnETHST',
    args: util.usc({ ethstAddresses, quantity, baseAddress }),
  };

  return rest.call(user, callArgs, options);
}

function getUSDSTAddress() {
  if (process.env.networkID === constants.prodNetworkId) {
    return constants.prodUSDSTAddress;
  } else if (process.env.networkID === constants.testnetNetworkId) {
    return constants.testnetUSDSTAddress;
  } else {
    return constants.prodUSDSTAddress;
  }
}

function getCataAddress() {
  if (process.env.networkID === constants.prodNetworkId) {
    return constants.prodCataAddress;
  } else if (process.env.networkID === constants.testnetNetworkId) {
    return constants.testnetCataAddress;
  } else {
    return constants.prodCataAddress;
  }
}

function getBridgeableAddress() {
  if (process.env.networkID === constants.prodNetworkId) {
      const { prodETHSTAddress, prodWBTCSTAddress, prodUSDTSTAddress, prodUSDCSTAddress, prodPAXGSTAddress } = constants;
    return { ethstAddress: prodETHSTAddress, wbtcstAddress:prodWBTCSTAddress, usdtstAddress:prodUSDTSTAddress, usdcstAddress:prodUSDCSTAddress, paxgstAddress:prodPAXGSTAddress };
  } else if (process.env.networkID === constants.testnetNetworkId) {
    const { testnetETHSTAddress, testnetWBTCSTAddress, testnetUSDTSTAddress, testnetUSDCSTAddress, testnetPAXGSTAddress } = constants;
    return { ethstAddress:testnetETHSTAddress, wbtcstAddress:testnetWBTCSTAddress, usdtstAddress:testnetUSDTSTAddress, usdcstAddress:testnetUSDCSTAddress, paxgstAddress:testnetPAXGSTAddress }
  } else {
    return { ethstAddress: prodETHSTAddress, wbtcstAddress:prodWBTCSTAddress, usdtstAddress:prodUSDTSTAddress, usdcstAddress:prodUSDCSTAddress, paxgstAddress:prodPAXGSTAddress };
  }
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
  uploadContract,
  contractName,
  contractFilename,
  bindAddress,
  marshalIn,
  marshalOut,
  addHash,
  burnETHST,
  getUSDSTAddress,
  getCataAddress,
  getBridgeableAddress,
  getStratsAddress
};
