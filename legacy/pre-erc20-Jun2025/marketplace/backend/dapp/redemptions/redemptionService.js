import { util, rest, importer } from '/blockapps-rest-plus';
import {
  setSearchQueryOptions,
  searchOne,
  searchAllWithQueryArgs,
} from '/helpers/utils';

const contractName = 'RedemptionService';
const externalContractName = 'ExternalRedemptionService';
const eventName = 'RedemptionService.Redemption';
const contractFilename = `${util.cwd}/dapp/mercata-base-contracts/Templates/Redemptions/ExternalRedemptionService.sol`;

/**
 * Upload a new RedemptionService
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of RedemptionService's constructor
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
  const args = {
    ..._args,
  };
  return args;
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

async function get(user, args, defaultOptions) {
  const { address, ...restArgs } = args;
  const options = { ...defaultOptions, org: 'BlockApps', app: 'Mercata' };
  let redemptionService;
  let searchArgs;

  if (address) {
    searchArgs = setSearchQueryOptions(restArgs, [
      { key: 'address', value: address },
      { key: 'isActive', value: 'true' },
    ]);
  } else {
    searchArgs = setSearchQueryOptions(restArgs, [
      { key: 'ownerCommonName', value: 'Server' },
      { key: 'isActive', value: 'true' },
    ]);
  }

  redemptionService = await searchOne(contractName, searchArgs, options, user);

  return redemptionService ? marshalOut(redemptionService) : undefined;
}

async function getAll(admin, args = {}, baseOptions) {
  const options = { ...baseOptions, org: 'BlockApps', app: 'Mercata' };
  const searchArgs = setSearchQueryOptions(args, [
    { key: 'isActive', value: 'true' },
  ]);
  const redemptionServices = await searchAllWithQueryArgs(
    contractName,
    searchArgs,
    options,
    admin
  );
  return redemptionServices.map((redemptionService) =>
    marshalOut(redemptionService)
  );
}

async function getRedemptions(admin, args = {}, baseOptions) {
  const options = { ...baseOptions, org: 'BlockApps', app: 'Mercata' };
  const redemptions = await searchAllWithQueryArgs(
    eventName,
    args,
    options,
    admin
  );
  return redemptions;
}

export default {
  uploadContract,
  contractName,
  contractFilename,
  get,
  getAll,
  getRedemptions,
  marshalIn,
  marshalOut,
};
