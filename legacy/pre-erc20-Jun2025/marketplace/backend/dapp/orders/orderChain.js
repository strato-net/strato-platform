import { util, rest, importer } from '/blockapps-rest-plus';
import config from '/load.config';

import { getYamlFile } from '/helpers/config';
import { getCurrentEnode } from '/helpers/enodeHelper';
import {
  waitForAddress,
  waitForOwner,
  setSearchQueryOptions,
  searchOne,
} from '/helpers/utils';
import certificateJs from '/dapp/certificates/certificate';
import orderJs from './order';
import constants from '/helpers/constants';

const deploymentOption = { config, logger: console };

/**
 * Create a new Order contract on a private chain via codePtr derivation
 * @param user User token (typically an admin)
 * @param args Arguments for Order contract creation
 * @param options Order deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */

const getChainArgs = (getKeyResponse, deploy, myCert, args) => {
  return {
    codePtr: {
      account: `${deploy.dapp.contract.address}:${deploy.dapp.contract.appChainId}`,
      name: orderJs.contractName,
    },
    parentChain: deploy.dapp.contract.appChainId,
    args: util.usc(args),
    members: [
      {
        orgName: myCert.organization,
        orgUnit: myCert.organizationalUnit || '',
        commonName: '',
        access: true,
      },
    ],
    balances: [
      {
        address: getKeyResponse,
        balance: 100000000000000000000000000000,
      },
      {
        address: deploy.dapp.contract.address,
        balance: 100000000000000000000000000000,
      },
      {
        address: constants.governanceAddress,
        balance: 100000000000000000000000000000,
      },
    ],
    metadata: {
      history: orderJs.contractName,
      VM: 'SolidVM',
    },
    name: orderJs.contractName,
    label: `Order-${util.uid()}-chain`,
  };
};

async function createOrder(user, args, options) {
  const getKeyResponse = await rest.getKey(user, options);
  const deploy = getYamlFile(
    `${config.configDirPath}/${config.deployFilename}`
  );
  const myCert = await certificateJs.getCertificateMe(user);

  const chainArgs = getChainArgs(getKeyResponse, deploy, myCert, args);

  const contractArgs = {
    name: orderJs.contractName,
  };

  const copyOfOptions = {
    ...options,
    history: [orderJs.contractName],
  };

  let error = [];

  if (error.length) {
    throw new Error(error.join('\n'));
  }

  const chainId = await rest.createChain(
    user,
    chainArgs,
    contractArgs,
    copyOfOptions
  );
  const waitOptions = {
    ...options,
    chainIds: [chainId],
  };
  const response = await waitForAddress(
    user,
    { address: constants.governanceAddress, name: orderJs.contractName },
    waitOptions
  );

  return orderJs.bindAddress(user, constants.governanceAddress, {
    ...options,
    chainIds: [chainId],
  });
}

export default {
  createOrder,
  getChainArgs,
};
