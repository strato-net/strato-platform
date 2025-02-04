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
const CREATOR = 'eq.BlockApps';
const IS_ACTIVE = 'eq.true';

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
        reserve.USDSTToken,
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
  const USDSTToken = results.find(
    (result) => result.address === reserve.USDSTToken
  );

  // Return combined result
  return {
    ...reserve,
    asset: asset ? marshalOut(asset) : null,
    tvl,
    totalCataRewardIssued,
    cataTokenObject: cataToken ? marshalOut(cataToken) : null,
    USDSTTokenObject: USDSTToken ? marshalOut(USDSTToken) : null,
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
      reserve.usdstToken,
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
        ? activeEscrows[0].sum / Math.pow(10, 18)
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
    const USDSTToken = relatedAssetsAndTokens.find(
      (item) => item.address === reserve.usdstToken
    );

    return {
      ...reserve,
      asset: asset ? marshalOut(asset) : null,
      cataTokenObject: cataToken ? marshalOut(cataToken) : null,
      USDSTTokenObject: USDSTToken ? marshalOut(USDSTToken) : null,
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
 * Unstake assets from multiple escrows.
 * @param {Object} user - User context for the request.
 * @param {Object} args - Arguments for unstaking.
 * @param {string} args.reserve - The reserve contract address.
 * @param {number} args.quantity - The total quantity to unstake.
 * @param {Array<string>} args.escrowAddresses - List of escrow contract addresses.
 * @param {Object} options - Additional options for the request.
 * @returns {Array} - Responses from each unstake transaction.
 * @throws {Error} - Throws if unstaking fails for any escrow.
 */
async function unstake(user, args, options) {
  const { reserve, quantity: requestedQuantity, escrowAddresses } = args;

  if (
    !reserve ||
    !requestedQuantity ||
    !escrowAddresses ||
    !Array.isArray(escrowAddresses)
  ) {
    throw new Error(
      'Invalid arguments: reserve, quantity, and escrowAddresses are required.'
    );
  }

  try {
    // Step 1: Fetch the escrows using the provided escrowAddresses
    const escrowSearchOptions = {
      ...options,
      query: {
        creator: CREATOR,
        isActive: IS_ACTIVE,
        select: 'address,collateralQuantity',
        address: `in.(${escrowAddresses.join(',')})`,
      },
    };

    const escrows = await rest.search(
      user,
      { name: 'BlockApps-Mercata-Escrow' },
      escrowSearchOptions
    );

    if (escrows.length === 0) {
      throw new Error('No active escrows found for the provided addresses.');
    }

    let remainingQuantity = requestedQuantity;
    const unstakePromises = [];

    // Step 2: For each escrow, unstake the min between escrow.collateralQuantity and remainingQuantity
    for (const escrow of escrows) {
      if (remainingQuantity <= 0) break;

      const unstakeAmount = Math.min(escrow.collateralQuantity, remainingQuantity);

      // Only proceed if unstakeAmount is greater than 0
      if (unstakeAmount > 0) {
        const callArgs = {
          contract: { address: reserve },
          method: 'unstake',
          args: util.usc({
            escrowAddress: escrow.address,
            quantity: unstakeAmount,
          }),
        };

        unstakePromises.push(rest.call(user, callArgs, options));
        remainingQuantity -= unstakeAmount;
      }
    }

    // Execute all unstake transactions concurrently
    await Promise.all(unstakePromises);

    return;
  } catch (error) {
    console.error('Error in unstake function:', error);
    throw error;
  }
}

/**
 * Borrow assets from multiple escrows.
 * @param {Object} user - User context for the request.
 * @param {Object} args - Arguments for borrowing.
 * @param {string} args.reserve - The reserve contract address.
 * @param {number} args.borrowAmount - The total amount to borrow.
 * @param {Array<string>} args.escrowAddresses - List of escrow contract addresses.
 * @param {Object} options - Additional options for the request.
 * @returns {Array} - Responses from each borrow transaction.
 * @throws {Error} - Throws if borrowing fails for any escrow or if validation fails.
 */
async function borrow(user, args, options) {
  const { reserve, borrowAmount, escrowAddresses } = args;

  if (escrowAddresses.length === 0) {
    throw new Error('At least one escrow address must be provided.');
  }
  try {
    // Step 1: Fetch the escrows using the provided escrowAddresses
    const escrowSearchOptions = {
      ...options,
      query: {
        creator: CREATOR,
        isActive: IS_ACTIVE,
        select: 'address,collateralQuantity',
        address: `in.(${escrowAddresses.join(',')})`,
      },
    };

    const escrows = await rest.search(
      user,
      { name: 'BlockApps-Mercata-Escrow' },
      escrowSearchOptions
    );

    if (escrows.length === 0) {
      throw new Error('No active escrows found for the provided addresses.');
    }

    // Step 2: Calculate total collateralQuantity
    const totalCollateral = escrows.reduce((acc, escrow) => acc + Number(escrow.collateralQuantity || 0), 0);

    if (totalCollateral <= 0) {
      throw new Error('Total collateral quantity is zero or negative. Cannot proceed with borrowing.');
    }

    // Step 3: Distribute borrowAmount proportionally based on collateralQuantity
    let distributedAmount = 0; // To keep track of the total distributed amount

    for (let i = 0; i < escrows.length; i++) {
      const escrow = escrows[i];
      let amountToBorrow;

      if (i < escrows.length - 1) {
        // Calculate proportional amount and floor it to ensure integer value
        amountToBorrow = Math.floor((Number(escrow.collateralQuantity) / totalCollateral) * borrowAmount);
        distributedAmount += amountToBorrow;
      } else {
        // Assign the remaining amount to the last escrow to handle any remainder
        amountToBorrow = borrowAmount - distributedAmount;
      }

      // Ensure that amountToBorrow is at least 0
      amountToBorrow = Math.max(amountToBorrow, 0);

      // Prepare callArgs
      const callArgs = {
        contract: { address: reserve },
        method: 'borrow',
        args: util.usc({
          escrowAddress: escrow.address,
          borrowAmount: amountToBorrow,
        }),
      };

      // Execute the borrow call
      await rest.call(user, callArgs, options);
    }

    return;
  } catch (error) {
    console.error('Error in borrow function:', error);
    throw error;
  }
}

/**
 * Repay
 */
async function repay(user, args, options) {
  const { reserve, escrowAddress, USDSTAssetAddresses } = args;
  const callArgs = {
    contract: { address: reserve },
    method: 'repayLoan',
    args: util.usc({ escrowAddress, usdstAssetAddresses:USDSTAssetAddresses}),
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
