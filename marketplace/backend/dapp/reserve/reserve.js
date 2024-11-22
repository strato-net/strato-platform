import { util, rest } from '/blockapps-rest-plus';
import { searchAllWithQueryArgs } from '/helpers/utils';
import constants from '../../helpers/constants';

const contractName = 'BlockApps-Mercata-Reserve';
const OracleContractName = 'BlockApps-Mercata-OracleService';

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
  // Define search options for active reserves
  const searchOptions = {
    ...options,
    query: {
      creator: 'eq.BlockApps',
      isActive: 'eq.true',
      address: 'eq.' + address,
    },
  };

  // Fetch reserves from Cirrus
  const reserves = await rest.search(
    user,
    { name: contractName },
    searchOptions
  );

  if (!reserves || reserves.length === 0) {
    throw new Error('No reserves found');
  }

  // Fetch asset information and attach it to the reserve
  const reserve = reserves[0];
  console.log('reserve123', reserve);
  const asset = await rest.search(
    user,
    { name: 'BlockApps-Mercata-Asset' },
    {
      ...options,
      query: {
        address: `eq.${reserve.assetRootAddress}`,
        select: constants.attachImagesAndFiles,
      },
    }
  );

  // Attach the first matching asset (or null) to the reserve
  return {
    ...reserve,
    asset: asset && asset[0] ? marshalOut(asset[0]) : null,
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
  // Define search options for active reserves
  const searchOptions = {
    ...options,
    query: {
      creator: 'eq.BlockApps',
      isActive: 'eq.true',
    },
  };

  // Fetch reserves from Cirrus
  const reserves = await rest.search(
    user,
    { name: contractName },
    searchOptions
  );

  if (!reserves || reserves.length === 0) {
    throw new Error('No reserves found');
  }

  // Fetch asset information and attach it to each reserve
  const reservesWithAssets = await Promise.all(
    reserves.map(async (reserve) => {
      const asset = await rest.search(
        user,
        { name: 'BlockApps-Mercata-Asset' },
        {
          ...options,
          query: {
            address: `eq.${reserve.assetRootAddress}`,
            select: constants.attachImagesAndFiles,
          },
        }
      );

      // Attach the first matching asset (or null) to the reserve
      return {
        ...reserve,
        asset: asset && asset[0] ? marshalOut(asset[0]) : null,
      };
    })
  );

  return reservesWithAssets;
}

/**
 * calculate
 */
async function calculate(user, args, options) {
  try {
    const { assetAmount, loanToValueRatio } = args;
    const oracleResponse = await searchAllWithQueryArgs(
      OracleContractName,
      { creator: 'Server', isActive: true },
      options,
      user
    );
    if (!oracleResponse || oracleResponse.length === 0) {
      throw new Error('No oracle response found');
    }
    const price = oracleResponse[0].consensusPrice;
    const result = (price * assetAmount * loanToValueRatio).toFixed(2);
    return result;
  } catch (error) {
    console.error('Error in calculate function:', error);
    throw error;
  }
}

/**
 * stake
 */
async function stake(user, args, options) {
  const { reserve, ...restArgs } = args;
  const callArgs = {
    contract: { address: reserve },
    method: 'createEscrow',
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
    method: 'unStake',
    args: util.usc({ ...args }),
  };

  const reponse = await rest.call(user, callArgs, options);
  return reponse;
}

export default {
  contractName,
  get,
  getAll,
  marshalIn,
  marshalOut,
  calculate,
  stake,
  unstake,
};
