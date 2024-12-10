import { util, rest } from '/blockapps-rest-plus';
import constants from '../../helpers/constants';
import { searchAllWithQueryArgs } from '/helpers/utils';

const contractName = 'BlockApps-Mercata-Reserve';
const contractTable = 'Reserve';
const OracleContractName = 'BlockApps-Mercata-OracleService';
const contractEvents = {
  STAKE_CREATED: 'StakeCreated',
  STAKE_UNLOCKED: 'StakeUnlocked',
};

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
    paymentSessionId: '',
    paymentService: '',
    paymentStatus: '',
    sessionStatus: '',
    amount: '',
    expiresAt: 0,
    createdDate: 0,
    sellerAccountId: '',
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
 * Retrieve contract state via Cirrus.
 * @param {Object} user - User context for the request.
 * @param {Object} options - Search options including chainId.
 * @returns {Array} - List of reserves with attached asset information.
 * @throws {Error} - Throws if no reserves are found.
 */
async function get(user, address, options) {
  const CREATOR = 'eq.BlockApps';
  const IS_ACTIVE = 'eq.true';

  // Fetch active reserves
  const reserveSearchOptions = {
    ...options,
    query: {
      creator: CREATOR,
      isActive: IS_ACTIVE,
      address: `eq.${address}`,
    },
  };

  const reserves = await rest.search(
    user,
    { name: contractName },
    reserveSearchOptions
  );
  if (!reserves || reserves.length === 0) {
    throw new Error('No active reserves found for the given address');
  }

  const reserve = reserves[0];

  // Fetch associated escrows
  const escrowTVLSearchOptions = {
    ...options,
    query: {
      creator: CREATOR,
      isActive: IS_ACTIVE,
      reserve: `eq.${reserve.address}`,
      select: 'collateralValue.sum()',
    },
  };

  const activeEscrows = await rest.search(
    user,
    { name: 'BlockApps-Mercata-Escrow' },
    escrowTVLSearchOptions
  );

  // Calculate TVL: Total Value Locked in Dollars
  const tvl =
    activeEscrows && activeEscrows.length > 0
      ? activeEscrows[0].sum / 10000
      : 0;

  // Total Cata Reward Issued in CATA
  const escrowTotalCataRewardSearchOptions = {
    ...options,
    query: {
      creator: CREATOR,
      reserve: `eq.${reserve.address}`,
      select: 'totalCataReward.sum()',
    },
  };

  const allEscrows = await rest.search(
    user,
    { name: 'BlockApps-Mercata-Escrow' },
    escrowTotalCataRewardSearchOptions
  );

  // Calculate total Cata reward issued
  const totalCataRewardIssued =
    allEscrows && allEscrows.length > 0
      ? allEscrows[0].sum / Math.pow(10, 18)
      : 0;

  // Fetch associated assets and tokens in one query
  const combinedSearchOptions = {
    ...options,
    query: {
      address: `in.(${[
        reserve.assetRootAddress,
        reserve.cataToken,
        reserve.stratsToken,
      ]
        .filter(Boolean)
        .join(',')})`,
      select: constants.attachImagesAndFiles,
    },
  };

  const results = await rest.search(
    user,
    { name: 'BlockApps-Mercata-Asset' },
    combinedSearchOptions
  );

  // Process the combined results
  const asset = results.find(
    (result) => result.address === reserve.assetRootAddress
  );
  const cataToken = results.find(
    (result) => result.address === reserve.cataToken
  );
  const stratsToken = results.find(
    (result) => result.address === reserve.stratsToken
  );

  // Return combined result
  return {
    ...reserve,
    asset: asset ? marshalOut(asset) : null,
    tvl,
    totalCataRewardIssued,
    cataTokenObject: cataToken ? marshalOut(cataToken) : null,
    stratsTokenObject: stratsToken ? marshalOut(stratsToken) : null,
  };
}

/**
 * Retrieve contract states via Cirrus.
 * @param {Object} user - User context for the request.
 * @param {Object} options - Search options including chainId.
 * @returns {Array} - List of reserves with attached asset information.
 * @throws {Error} - Throws if no reserves are found.
 */
async function getAll(user, options) {
  const CREATOR = 'eq.BlockApps';
  const IS_ACTIVE = 'eq.true';

  // Fetch all active reserves
  const searchOptions = {
    ...options,
    query: {
      creator: CREATOR,
      isActive: IS_ACTIVE,
    },
  };

  const reserves = await rest.search(
    user,
    { name: contractName },
    searchOptions
  );

  if (!reserves || reserves.length === 0) {
    throw new Error('No reserves found');
  }

  // Collect all related addresses for a combined query
  const assetAndTokenAddresses = reserves
    .flatMap((reserve) => [
      reserve.assetRootAddress,
      reserve.cataToken,
      reserve.stratsToken,
    ])
    .filter(Boolean);

  const combinedSearchOptions = {
    ...options,
    query: {
      address: `in.(${assetAndTokenAddresses.join(',')})`,
      select: constants.attachImagesAndFiles,
    },
  };

  const relatedAssetsAndTokens = await rest.search(
    user,
    { name: 'BlockApps-Mercata-Asset' },
    combinedSearchOptions
  );

  // Fetch all TVL and total Cata rewards for reserves
  const tvlAndCataRewardPromises = reserves.map(async (reserve) => {
    const escrowTVLSearchOptions = {
      ...options,
      query: {
        creator: CREATOR,
        isActive: IS_ACTIVE,
        reserve: `eq.${reserve.address}`,
        select: 'collateralValue.sum()',
      },
    };

    const activeEscrows = await rest.search(
      user,
      { name: 'BlockApps-Mercata-Escrow' },
      escrowTVLSearchOptions
    );

    const tvl =
      activeEscrows && activeEscrows.length > 0
        ? activeEscrows[0].sum / 10000
        : 0;

    const escrowTotalCataRewardSearchOptions = {
      ...options,
      query: {
        creator: CREATOR,
        reserve: `eq.${reserve.address}`,
        select: 'totalCataReward.sum()',
      },
    };

    const allEscrows = await rest.search(
      user,
      { name: 'BlockApps-Mercata-Escrow' },
      escrowTotalCataRewardSearchOptions
    );

    const totalCataRewardIssued =
      allEscrows && allEscrows.length > 0
        ? allEscrows[0].sum / Math.pow(10, 18)
        : 0;

    return { tvl, totalCataRewardIssued };
  });

  const tvlAndCataRewards = await Promise.all(tvlAndCataRewardPromises);

  // Attach assets, tokens, TVL, and Cata rewards to reserves
  const reservesWithDetails = reserves.map((reserve, index) => {
    const asset = relatedAssetsAndTokens.find(
      (item) => item.address === reserve.assetRootAddress
    );
    const cataToken = relatedAssetsAndTokens.find(
      (item) => item.address === reserve.cataToken
    );
    const stratsToken = relatedAssetsAndTokens.find(
      (item) => item.address === reserve.stratsToken
    );

    return {
      ...reserve,
      asset: asset ? marshalOut(asset) : null,
      cataTokenObject: cataToken ? marshalOut(cataToken) : null,
      stratsTokenObject: stratsToken ? marshalOut(stratsToken) : null,
      ...tvlAndCataRewards[index],
    };
  });

  return reservesWithDetails;
}

/**
 * Get live Oracle price
 */
async function oraclePrice(user, address, options) {
  try {
    // Define search options for active reserves
    const searchOptions = {
      ...options,
      query: {
        creator: 'eq.Server',
        isActive: 'eq.true',
        address: 'eq.' + address,
      },
    };

    // Fetch reserves from Cirrus
    const oracles = await rest.search(
      user,
      { name: OracleContractName },
      searchOptions
    );

    if (!oracles || oracles.length === 0) {
      throw new Error('No oracles found');
    }

    const oracle = oracles[0];

    return oracle;
  } catch (error) {
    console.error('Error in oraclePrice function:', error);
    throw error;
  }
}

/**
 * stake
 */
async function stake(user, args, options) {
  const { reserve, escrowAddress, ...restArgs } = args;
  const callArgs = {
    contract: { address: reserve },
    method: 'stakeAsset',
    args: util.usc({
      escrowAddress: escrowAddress || constants.zeroAddress,
      ...restArgs,
    }),
  };

  const reponse = await rest.call(user, callArgs, options);
  return reponse[0];
}

/**
 * unstake
 */
async function unstake(user, args, options) {
  const { reserve, ...restArgs } = args;
  const callArgs = {
    contract: { address: reserve },
    method: 'unstake',
    args: util.usc({ ...restArgs }),
  };

  const reponse = await rest.call(user, callArgs, options);
  return reponse;
}

/**
 * Borrow
 */
async function borrow(user, args, options) {
  const { reserve, ...restArgs } = args;
  const callArgs = {
    contract: { address: reserve },
    method: 'borrow',
    args: util.usc({ ...restArgs }),
  };

  const reponse = await rest.call(user, callArgs, options);
  return reponse;
}

/**
 * Repay
 */
async function repay(user, args, options) {
  const { reserve, ...restArgs } = args;
  const callArgs = {
    contract: { address: reserve },
    method: 'repayLoan',
    args: util.usc({ ...args }),
  };

  const reponse = await rest.call(user, callArgs, options);
  return reponse;
}

/**
 * Fetch StakeCreated Events
 */
async function getStakeCreatedEvents(admin, args = {}, defaultOptions) {
  const options = { ...defaultOptions, org: 'BlockApps', app: 'Mercata' };
  const stakeCreatedEvents = await searchAllWithQueryArgs(
    `${contractTable}.${contractEvents.STAKE_CREATED}`,
    args,
    options,
    admin
  );

  const total = await searchAllWithQueryArgs(
    `${contractTable}.${contractEvents.STAKE_CREATED}`,
    {
      ...args,
      queryOptions: { select: 'count' },
    },
    options,
    admin
  );

  return {
    stakeCreatedEvents: stakeCreatedEvents.map(marshalOut),
    total: total[0]?.count,
  };
}

/**
 * Fetch StakeUnlocked Events
 */
async function getUnstakeEvents(admin, args = {}, defaultOptions) {
  const options = { ...defaultOptions, org: 'BlockApps', app: 'Mercata' };
  const unstakeEvents = await searchAllWithQueryArgs(
    `${contractTable}.${contractEvents.STAKE_UNLOCKED}`,
    args,
    options,
    admin
  );

  const total = await searchAllWithQueryArgs(
    `${contractTable}.${contractEvents.STAKE_UNLOCKED}`,
    {
      ...args,
      queryOptions: { select: 'count' },
    },
    options,
    admin
  );

  return {
    unstakeEvents: unstakeEvents.map(marshalOut),
    total: total[0]?.count,
  };
}

export default {
  contractName,
  get,
  getAll,
  getStakeCreatedEvents,
  getUnstakeEvents,
  marshalIn,
  marshalOut,
  oraclePrice,
  stake,
  unstake,
  borrow,
  repay,
};
