import { util, rest } from '/blockapps-rest-plus';
import constants from '../../helpers/constants';
import { searchAllWithQueryArgs } from '/helpers/utils';

const contractName = 'BlockApps-Mercata-Escrow';
const assetsArrayName = 'BlockApps-Mercata-Escrow-assets';

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
 * Retrieve contract state via Cirrus.
 * @param {Object} user - User context for the request.
 * @param {Object} options - Search options including chainId.
 * @returns {Array} - List of escrows with attached asset information.
 * @throws {Error} - Throws if no escrows are found.
 */
async function get(user, address, options) {
  // Define search options for active escrows
  const searchOptions = {
    ...options,
    query: {
      select: `*,${assetsArrayName}(*)`,
      isActive: 'eq.true',
      address: 'eq.' + address,
    },
  };

  // Fetch escrows from Cirrus
  const escrows = await rest.search(
    user,
    { name: contractName },
    searchOptions
  );

  if (!escrows || escrows.length === 0) {
    return undefined;
  }

  // Fetch asset information and attach it to the escrow
  const escrow = escrows[0];

  const asset = await rest.search(
    user,
    { name: 'BlockApps-Mercata-Asset' },
    {
      ...options,
      query: {
        address: `like.${escrow.assetRootAddress}*`,
        select: constants.attachImagesAndFiles,
      },
    }
  );

  // Attach the first matching asset (or null) to the escrow
  return {
    ...escrow,
    asset: asset && asset[0] ? marshalOut(asset[0]) : null,
  };
}

/**
 * Retrieve contract states via Cirrus.
 * @param {Object} user - User context for the request.
 * @param {Object} options - Search options including chainId.
 * @returns {Array} - List of escrows with attached asset information.
 * @throws {Error} - Throws if no escrows are found.
 */
async function getAll(user, options) {
  // Define search options for active escrows
  const searchOptions = {
    ...options,
    query: {
      select: `*,${assetsArrayName}(*)`,
      isActive: 'eq.true',
    },
  };

  // Fetch escrows from Cirrus
  const escrows = await rest.search(
    user,
    { name: contractName },
    searchOptions
  );

  if (!escrows || escrows.length === 0) {
    throw new Error('No escrows found');
  }

  // Fetch asset information and attach it to each escrow
  const escrowsWithAssets = await Promise.all(
    escrows.map(async (escrow) => {
      const asset = await rest.search(
        user,
        { name: 'BlockApps-Mercata-Asset' },
        {
          ...options,
          query: {
            address: `eq.${escrow.assetRootAddress}`,
            select: constants.attachImagesAndFiles,
          },
        }
      );

      // Attach the first matching asset (or null) to the escrow
      return {
        ...escrow,
        asset: asset && asset[0] ? marshalOut(asset[0]) : null,
      };
    })
  );

  return escrowsWithAssets;
}

async function getEscrowsForStakeTransactions(user, args, options) {
  const { address } = args;
  const batchSize = 50;

  if (!Array.isArray(address)) {
    throw new Error('Address must be an array');
  }

  const batches = [];
  for (let i = 0; i < address.length; i += batchSize) {
    batches.push(address.slice(i, i + batchSize));
  }

  let allEscrows = [];
  let totalCount = 0;

  // Fetch each batch
  for (const batch of batches) {
    const batchArgs = { ...args, address: batch };
    const escrows = await searchAllWithQueryArgs(
      contractName,
      batchArgs,
      options,
      user
    );

    const total = await searchAllWithQueryArgs(
      contractName,
      {
        ...batchArgs,
        queryOptions: { select: 'count' },
      },
      options,
      user
    );

    // Append batch results
    allEscrows = allEscrows.concat(escrows);
    totalCount += total[0]?.count || 0;
  }

  if (allEscrows.length === 0) {
    return {
      escrows: [],
      total: 0,
    };
  }

  return {
    escrows: allEscrows,
    total: totalCount,
  };
}

/**
 * Retrieve contract state via Cirrus.
 * @param {Object} user - User context for the request.
 * @param {Object} options - Search options including chainId.
 * @returns {Object} - Escrow with attached asset information, or undefined if none exists.
 * @throws {Error} - Throws if no escrows are found.
 */
async function getEscrowForAsset(user, queryArgs, options) {
  // Define search options for active escrows
  const searchOptions = {
    ...options,
    query: {
      ...queryArgs,
    },
  };

  // Fetch escrows from Cirrus
  const assets = await rest.search(
    user,
    { name: assetsArrayName },
    searchOptions
  );

  if (!assets || assets.length === 0) {
    return undefined;
  }

  return get(user, assets[0].address, options);
}

/**
 * Retrieve contract state via Cirrus.
 * @param {Object} user - User context for the request.
 * @param {Object} options - Search options including chainId.
 * @returns {Object} - Escrow with attached asset information, or undefined if none exists.
 * @throws {Error} - Throws if no escrows are found.
 */
async function searchEscrow(user, queryArgs, options) {
  // Define search options for active escrows
  const searchOptions = {
    ...options,
    query: {
      ...queryArgs,
    },
  };

  // Fetch escrows from Cirrus
  const assets = await rest.search(user, { name: contractName }, searchOptions);

  if (!assets || assets.length === 0) {
    return undefined;
  }

  return get(user, assets[0].address, options);
}

// Get Total CATA Rewards for a user
async function userCataRewards(user, userCommonName, options) {
  // Get Active reseve addressess
  const searchOptions = {
    ...options,
    query: {
      isActive: 'eq.true',
      select: `address`,
    },
  };

  const reserves = await rest.search(
    user,
    { name: 'BlockApps-Mercata-Reserve' },
    searchOptions
  );

  if (!reserves || reserves.length === 0) {
    return undefined;
  }

  const reserveAddresses = reserves.map((reserve) => reserve.address);

  const searchOptionsTotalCataReward = {
    ...options,
    query: {
      borrowerCommonName: `eq.${userCommonName}`,
      select: `totalCataReward.sum()`,
      reserve: `in.(${reserveAddresses.join(',')})`,
    },
  };

  const totalCataRewardResult = await rest.search(
    user,
    { name: contractName },
    searchOptionsTotalCataReward
  );

  if (!totalCataRewardResult || totalCataRewardResult.length === 0) {
    return undefined;
  }

  const totalCataReward = totalCataRewardResult[0].sum
    ? totalCataRewardResult[0].sum / 10 ** 18
    : 0;

  const searchOptionsDailyCataReward = {
    ...options,
    query: {
      borrowerCommonName: `eq.${userCommonName}`,
      isActive: 'eq.true',
      select: `collateralValue.sum()`,
      reserve: `in.(${reserveAddresses.join(',')})`,
    },
  };

  const dailyCataRewardResult = await rest.search(
    user,
    { name: contractName },
    searchOptionsDailyCataReward
  );

  if (!dailyCataRewardResult || dailyCataRewardResult.length === 0) {
    return undefined;
  }

  const totalCurrentColleteralValue = dailyCataRewardResult[0].sum
    ? dailyCataRewardResult[0].sum
    : 0;
  const dailyCataReward = totalCurrentColleteralValue / Math.pow(10, 18) / 365;

  return { totalCataReward, dailyCataReward };
}

export default {
  contractName,
  get,
  getAll,
  getEscrowsForStakeTransactions,
  getEscrowForAsset,
  searchEscrow,
  userCataRewards,
  marshalIn,
  marshalOut,
};
