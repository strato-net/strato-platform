import { util, rest, importer } from '/blockapps-rest-plus';
// import config from '/load.config';
import RestStatus from 'http-status-codes';
import {
  setSearchQueryOptions,
  search,
  searchOne,
  searchAll,
  searchAllWithQueryArgs,
} from '/helpers/utils';
// import dayjs from 'dayjs';

const tablePrefix = 'BlockApps-Mercata-';
const contractName = 'PaymentService';
const externalContractName = 'ExternalPaymentService';
const onboardedEventName = 'PaymentService.SellerOnboarded';
const contractFilename = `${util.cwd}/dapp/mercata-base-contracts/Templates/Payments/ExternalPaymentService.sol`;

/**
 * Upload a new PaymentService
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of PaymentService's constructor
 * @param options  deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 * @returns Contract object
 * */
async function uploadContract(user, _constructorArgs, options) {
  const constructorArgs = marshalIn(_constructorArgs);

  const contractArgs = {
    name: externalContractName,
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

  return bind(user, contract, copyOfOptions);
}

/**
 * Augment contract arguments before they are used to post a contract.
 * Its counterpart is {@link marshalOut `marshalOut`}.
 *
 * As our arguments come into the paymentService contract they first pass through `marshalIn` and
 * when we retrieve contract state they pass through {@link marshalOut `marshalOut`}.
 *
 * (A mathematical analogy: `marshalIn` and {@link marshalOut `marshalOut`} form something like a
 * homomorphism)
 * @param args - Contract state
 */
function marshalIn(_args) {
  const defaultArgs = {
    name: 1,
    accountId: '',
    accountLinked: true,
    status: '',
    createdDate: 0,
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
 * As our arguments come into the paymentService contract they first pass through {@link marshalIn `marshalIn`}
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
 * Bind functions relevant for paymentService to the _contract object.
 * @param user User token
 * @param _contract Contract object from `rest.createContract()` etc.
 * @param options PaymentService deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */

function bind(user, _contract, options) {
  const contract = { ..._contract };

  contract.get = async (args = { address: contract.address }) =>
    get(user, args, options);
  contract.getState = async () => getState(user, contract, options);
  contract.getMembers = async () => getMembers(user, contract, options);
  contract.getHistory = async (args, options = contractOptions) =>
    getHistory(user, chainId, args, options);
  contract.chainIds = options.chainIds;

  return contract;
}

/**
 * Bind an existing PaymentService contract to a new user token. Useful for having multiple users test
 * the same contract.
 * @example <caption>Create an admin and user bound to the same new paymentService contract.</caption>
 * const adminBoundContract = uploadContract(adminToken, args, options);
 * const userBoundContract = bindAddress(userToken, adminBoundContract.address, options);
 * @param user User token
 * @param address Address of the PaymentService contract
 * @param options PaymentService deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
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
 * @param args Lookup with an address or uniquePaymentServiceID.
 * @returns Contract state in cirrus
 */

async function get(user, args, defaultOptions) {
  const {
    ownerCommonName,
    name,
    address,
    accountId,
    accountDeauthorized,
    transaction_sender,
    ...restArgs
  } = args;
  const options = { ...defaultOptions, org: 'BlockApps', app: 'Mercata' };
  let paymentService;

  if (address) {
    const searchArgs = setSearchQueryOptions(restArgs, [
      { key: 'address', value: address },
      { key: 'order', value: 'chargesEnabled.desc,block_timestamp.desc' },
    ]);
    paymentService = await search(contractName, searchArgs, options, user);
  } else if (ownerCommonName) {
    let searchValues = [
      { key: 'ownerCommonName', value: ownerCommonName },
      { key: 'name', value: name },
      { key: 'order', value: 'chargesEnabled.desc,block_timestamp.desc' },
    ];
    if (accountDeauthorized != undefined) {
      searchValues.push({
        key: 'accountDeauthorized',
        value: accountDeauthorized,
      });
    }
    const searchArgs = setSearchQueryOptions(restArgs, searchValues);
    paymentService = await search(contractName, searchArgs, options, user);
  } else if (transaction_sender) {
    const searchArgs = setSearchQueryOptions(restArgs, [
      { key: 'transaction_sender', value: transaction_sender },
      { key: 'name', value: name },
      { key: 'order', value: 'chargesEnabled.desc,block_timestamp.desc' },
    ]);
    paymentService = await search(contractName, searchArgs, options, user);
  }
  if (!paymentService) {
    return [];
  }

  return paymentService.map((p) => marshalOut({ ...p }));
}

async function getAll(admin, args = {}, baseOptions) {
  const { onlyActive, ...restArgs } = args;
  const options = { ...baseOptions, org: 'BlockApps', app: 'Mercata' };
  let searchArgs;
  if (onlyActive) {
    searchArgs = setSearchQueryOptions(restArgs, [
      { key: 'isActive', value: 'true' },
    ]);
  } else {
    searchArgs = setSearchQueryOptions(restArgs, {});
  }
  const paymentServices = await searchAllWithQueryArgs(
    contractName,
    searchArgs,
    options,
    admin
  );
  return paymentServices.map((paymentService) => marshalOut(paymentService));
}

async function getNotOnboarded(admin, args = {}, baseOptions) {
  const { sellersCommonName, ...restArgs } = args;

  // Step 1: Fetch onboarded events
  const eventContract = { name: `${tablePrefix}${onboardedEventName}` };
  const onboardedQuery = {
    sellersCommonName: `eq.${sellersCommonName}`,
    select: `ownerCommonName,serviceName,isActive,block_timestamp`,
    ownerCommonName: `neq.null`,
    serviceName: `neq.null`,
  };
  const onboardedOptions = { ...baseOptions, query: onboardedQuery };
  const onboardedEventsRes = await rest.search(
    admin,
    eventContract,
    onboardedOptions
  );

  // Step 2: Get latest unique active entries
  const latestActiveEntries = Array.from(
    onboardedEventsRes.reduce((map, entry) => {
      const key = `${entry.serviceName}-${entry.ownerCommonName}`;
      const entryTimestamp = new Date(entry.block_timestamp);

      if (
        !map.has(key) ||
        entryTimestamp > new Date(map.get(key).block_timestamp)
      ) {
        map.set(key, entry);
      }
      return map;
    }, new Map())
  )
    .map(([, value]) => value) // Extract the values from the Map
    .filter((entry) => entry.isActive); // Keep only active entries

  // Step 3: Build exclusion query using onboarded services
  const onboardedServices = latestActiveEntries.map(
    (oe) =>
      `or(ownerCommonName.neq."${oe.ownerCommonName}",serviceName.neq."${oe.serviceName}")`
  );
  const contract = { name: `${tablePrefix}${contractName}` };
  const notOnboardedQuery = {
    isActive: 'eq.true',
    contract_name: `like.*${externalContractName}`,
    and:
      onboardedServices.length > 0
        ? `(${onboardedServices.join(',')})`
        : undefined,
  };
  const notOnboardedOptions = { ...baseOptions, query: notOnboardedQuery };
  const paymentServices = await rest.search(
    admin,
    contract,
    notOnboardedOptions
  );
  return paymentServices.map((paymentService) => marshalOut(paymentService));
}

/**
 * Get contract state in bloc.
 * @deprecated Use {@link get `get`} instead.
 */
async function getState(user, contract, options) {
  const state = await rest.getState(user, contract, options);
  return marshalOut(state);
}

async function createPayment(user, args, options) {
  const { address, ...restArgs } = args;
  const contract = { name: contractName, address };
  const callArgs = {
    contract,
    method: 'checkoutInitialized',
    args: util.usc({ ...restArgs }),
  };
  const token = await rest.call(user, callArgs, options);

  return token;
}

async function finalizePayment(user, args, options) {
  const { address, ...restArgs } = args;
  const contract = { name: contractName, ..._contract };
  const callArgs = {
    contract,
    method: 'finalizePayment',
    args: util.usc({ ...restArgs }),
  };
  const finalizeStatus = await rest.call(user, callArgs, options);

  if (parseInt(finalizeStatus, 10) !== RestStatus.OK) {
    throw new rest.RestError(
      finalizeStatus,
      "You cannot finalize the payment because it isn't active",
      { callArgs }
    );
  }

  return finalizeStatus;
}

async function updatePaymentService(admin, contract, _args, baseOptions) {
  const args = { ..._args };

  const scheme = Object.keys(_args).reduce((agg, key) => {
    const base = 1;
    switch (key) {
      case 'chargesEnabled':
        return agg | (base << 0);
      case 'detailsSubmitted':
        return agg | (base << 1);
      case 'payoutsEnabled':
        return agg | (base << 2);
      case 'eventTime':
        return agg | (base << 3);
      case 'accountDeauthorized':
        return agg | (base << 4);
      default:
        return agg;
    }
  }, 0);

  const callArgs = {
    contract,
    method: 'update',
    args: util.usc({
      scheme,
      ...args,
    }),
  };

  const options = {
    ...baseOptions,
    history: [contractName],
  };

  const [restStatus, paymentServiceAddress] = await rest.call(
    admin,
    callArgs,
    options
  );

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, paymentServiceAddress];
}

export default {
  uploadContract,
  contractName,
  contractFilename,
  bindAddress,
  get,
  getAll,
  getNotOnboarded,
  marshalIn,
  marshalOut,
  getHistory,
  createPayment,
  finalizePayment,
  updatePaymentService,
};
