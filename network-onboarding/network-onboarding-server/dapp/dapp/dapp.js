import { rest, importer } from "blockapps-rest";
const { createContract } = rest;
import config from "../../load.config";
import { yamlWrite, yamlSafeDumpSync } from "../../helpers/config";

const contractName = "NetworkOnboardingDapp";
const contractFilename = `${config.dappPath}/dapp/contracts/NetworkOnboardingDapp.sol`;

function deploy(contract, args, options) {
  // author the deployment
  const { deployFilename } = args

  const deployment = {
    url: options.config.nodes[0].url,
    dapp: {
      contract: {
        name: contract.name,
        address: contract.address
      }
    }
  };

  if (options.config.apiDebug) {
    console.log("deploy filename:", deployFilename);
    console.log(yamlSafeDumpSync(deployment));
  }

  yamlWrite(deployment, deployFilename);

  return deployment;
}

async function uploadContract(token, options) {
  const source = await importer.combine(contractFilename)
  const contractArgs = {
    name: contractName,
    source
  };

  const contract = await createContract(token, contractArgs, options);
  contract.src = "removed";

  await waitDapp(admin, contract.address, options)

  return bind(token, contract, options);
}

async function waitDapp(admin, dappAddress, options) {
  const contractArgs = {
    name: contractName,
    address: dappAddress,
  }
  // wait for the data to show up in search
  const dappInSearch = await rest.waitForAddress(admin, contractArgs, options)
  return dappInSearch
}

async function getManagers(admin, contract, options) {
  const state = await rest.getState(admin, contract, options)

  const membershipsManager = organizationMembershipsManagerJs.bindAddress(admin, state.membershipManager, options)
  const permissionManager = permissionManagerJs.bindAddress(admin, state.permissionManager, options)
  const organizationsManager = organizationsManagerJs.bindAddress(admin, state.organizationsManager, options)
  const usersManager = networkOnboardingUsersManagerJs.bindAddress(admin, state.userManager, options)
  const applicationsManager = applicationsManagerJs.bindAddress(admin, state.applicationsManager, options)

  return {
    membershipsManager,
    permissionManager,
    organizationsManager,
    usersManager,
    applicationsManager
  }
}

function bind(rawAdmin, _contract, defaultOptions) {
  const contract = _contract;
  const dappAddress = contract.address
  const admin = { dappAddress, ...rawAdmin }
  const managers = await getManagers(admin, contract, defaultOptions)

  contract.managers = managers
  contract.getState = async function (args, options = defaultOptions) {
    return rest.getState(admin, contract, options)
  }

  contract.deploy = function (args, options = defaultOptions) {
    const deployment = deploy(contract, args, options);
    return deployment;
  };
  contract.createApplication = async function (args, options = defaultOptions) {
    return managers.applicationsManager.createApplication(args, options)
  }
  contract.createOrganization = async function (args, options = defaultOptions) {
    return managers.organizationsManager.createOrganization(args, options)
  }
  contract.getOrganization = async function (args, options = defaultOptions) {
    return managers.organizationsManager.get(args, options)
  }
  contract.registerUser = async function (args, options = defaultOptions) {
    return managers.usersManager.registerUser(args, options)
  }
  contract.getUser = async function (args, options = defaultOptions) {
    return managers.usersManager.getUser(args, options)
  }
  contract.getAllOrganizations = async function (args, options = defaultOptions) {
    return managers.organizationsManager.get(args, options)
  }
  return contract;
}

export default {
  bind,
  uploadContract
};
