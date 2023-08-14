import { util, rest, importer } from "/blockapps-rest-plus";
import config from "/load.config";
import RestStatus from "http-status-codes";
import {
  setSearchQueryOptions,
  searchOne,
  searchAll,
  searchAllWithQueryArgs,
  setSearchQueryOptionsPrime,
} from "/helpers/utils";
import dayjs from "dayjs";

const contractName = "ProductFile";
const contractFilename = `${util.cwd}/dapp/productFile/contracts/ProductFile.sol`;

/**
 * Upload a new ProductFile
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of ProductFile's constructor
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
    throw new Error(error.join("\n"));
  }

  const copyOfOptions = {
    ...options,
    history: contractName,
  };

  const contract = await rest.createContract(user, contractArgs, copyOfOptions);
  contract.src = "removed";

  return bind(user, contract, copyOfOptions);
}

/**
 * Augment contract arguments before they are used to post a contract.
 * Its counterpart is {@link marshalOut `marshalOut`}.
 *
 * As our arguments come into the productFile contract they first pass through `marshalIn` and
 * when we retrieve contract state they pass through {@link marshalOut `marshalOut`}.
 *
 * (A mathematical analogy: `marshalIn` and {@link marshalOut `marshalOut`} form something like a
 * homomorphism)
 * @param args - Contract state
 */
function marshalIn(_args) {
  const defaultArgs = {
    productId: "0",
    fileLocation: "",
    fileHash: "",
    fileName: "",
    uploadDate: 0,
    createdDate: 0,
    currentSection: 1,
    currentType: 1
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
 * As our arguments come into the productFile contract they first pass through {@link marshalIn `marshalIn`}
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
 * Bind functions relevant for productFile to the _contract object.
 * @param user User token
 * @param _contract Contract object from `rest.createContract()` etc.
 * @param options ProductFile deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */

function bind(user, _contract, options) {
  const contract = { ..._contract };

  contract.get = async (args = { address: contract.address }) =>
    get(user, args, options);
  contract.getState = async () => getState(user, contract, options);
  contract.transferOwnership = async (newOwner) =>
    transferOwnership(user, contract, options, newOwner);
  contract.update = async (args) => update(user, contract, args, options);
  contract.addOrg = async (orgName) => addOrg(user, contract, options, orgName);
  contract.addOrgUnit = async (orgName, orgUnit) =>
    addOrgUnit(user, contract, options, orgName, orgUnit);
  contract.addMember = async (orgName, orgUnit, commonName) =>
    addMember(user, contract, options, orgName, orgUnit, commonName);
  contract.removeOrg = async (orgName) =>
    removeOrg(user, contract, options, orgName);
  contract.removeOrgUnit = async (orgName, orgUnit) =>
    removeOrgUnit(user, contract, options, orgName, orgUnit);
  contract.removeMember = async (orgName, orgUnit, commonName) =>
    removeMember(user, contract, options, orgName, orgUnit, commonName);
  contract.addOrgs = async (orgNames) =>
    addOrgs(user, contract, options, orgNames);
  contract.addOrgUnits = async (orgNames, orgUnits) =>
    addOrgUnits(user, contract, options, orgNames, orgUnits);
  contract.addMembers = async (orgNames, orgUnits, commonNames) =>
    addMembers(user, contract, options, orgNames, orgUnits, commonNames);
  contract.removeOrgs = async (orgNames) =>
    removeOrgs(user, contract, options, orgNames);
  contract.removeOrgUnits = async (orgNames, orgUnits) =>
    removeOrgUnits(user, contract, options, orgNames, orgUnits);
  contract.removeMembers = async (orgNames, orgUnits, commonNames) =>
    removeMembers(user, contract, options, orgNames, orgUnits, commonNames);
  contract.getMembers = async () => getMembers(user, contract, options);
  contract.getHistory = async (args, options = contractOptions) =>
    getHistory(user, chainId, args, options);
  contract.chainIds = options.chainIds;

  return contract;
}

/**
 * Bind an existing ProductFile contract to a new user token. Useful for having multiple users test
 * the same contract.
 * @example <caption>Create an admin and user bound to the same new productFile contract.</caption>
 * const adminBoundContract = uploadContract(adminToken, args, options);
 * const userBoundContract = bindAddress(userToken, adminBoundContract.address, options);
 * @param user User token
 * @param address Address of the ProductFile contract
 * @param options ProductFile deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
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
 * @param args Lookup with an address or uniqueProductFileID.
 * @returns Contract state in cirrus
 */

async function get(user, args, options) {
  const { uniqueProductFileID, address, ...restArgs } = args;
  let productFile;

  if (address) {
    const searchArgs = setSearchQueryOptions(restArgs, {
      key: "address",
      value: address,
    });
    productFile = await searchOne(contractName, searchArgs, options, user);
  } else {
    const searchArgs = setSearchQueryOptions(restArgs, {
      key: "uniqueProductFileID",
      value: uniqueProductFileID,
    });
    productFile = await searchOne(contractName, searchArgs, options, user);
  }
  if (!productFile) {
    return undefined;
  }

  return marshalOut({ ...productFile });
}

async function getAll(admin, args = {}, options) {
  const productFiles = await searchAllWithQueryArgs(
    contractName,
    args,
    options,
    admin
  );
  return productFiles.map((productFile) => marshalOut(productFile));
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
 * Update ProductFile
 */
async function update(admin, contract, _args, baseOptions) {
  const args = marshalIn(_args);

  const scheme = Object.keys(_args).reduce((agg, key) => {
    const base = 1;
    switch (key) {
      case "fileLocation":
        return agg | (base << 0);
      case "fileHash":
        return agg | (base << 1);
      case "fileName":
        return agg | (base << 2);
      case "uploadDate":
        return agg | (base << 3);
      case "section":
        return agg | (base << 4);
      case "type":
        return agg | (base << 5);
      default:
        return agg;
    }
  }, 0);

  const callArgs = {
    contract,
    method: "update",
    args: util.usc({
      scheme,
      ...args,
    }),
  };

  const options = {
    ...baseOptions,
    history: [contractName],
  };

  const [restStatus, ProductFileAddress] = await rest.call(
    admin,
    callArgs,
    options
  );

  if (parseInt(restStatus, 10) !== RestStatus.OK)
    throw new rest.RestError(restStatus, 0, { callArgs });

  return [restStatus, ProductFileAddress];
}

export default {
  uploadContract,
  contractName,
  contractFilename,
  bindAddress,
  get,
  getAll,
  update,
  marshalIn,
  marshalOut,
  getHistory,
};
