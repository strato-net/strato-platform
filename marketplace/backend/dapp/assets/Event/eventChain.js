import { util, rest, importer } from '/blockapps-rest-plus';
import config from '/load.config';

import { getYamlFile } from '/helpers/config';
import { getCurrentEnode } from '/helpers/enodeHelper';
import { waitForAddress, waitForOwner, setSearchQueryOptions, searchOne } from '/helpers/utils'
import certificateJs from '/dapp/certificates/certificate'
import eventJs from './event';
import constants from '/helpers/constants';

const deploymentOption = { config, logger: console };

/** 
 * Create a new Event contract on a private chain via codePtr derivation
 * @param user User token (typically an admin)
 * @param args Arguments for Event contract creation
 * @param options Event deployment options (found in _/config/*.config.yaml_ via _load.config.js_) 
 */
async function createEvent(user, args, options) {
    const getKeyResponse = await rest.getKey(user, options);
    const deploy = getYamlFile(`${config.configDirPath}/${config.deployFilename}`);
    console.log("user\n\n\n\n\n", user);
    const myCert = await certificateJs.getCertificateMe(user)


    // const enode = await getCurrentEnode() 

    const chainArgs = {
        codePtr: {
          account: `${deploy.dapp.contract.address}:${deploy.dapp.contract.appChainId}`,
            name: eventJs.contractName,
        },
        parentChain: deploy.dapp.contract.appChainId,
        args: util.usc(args),
        members: [
            {
                orgName: myCert.organization,
                orgUnit: myCert.organizationalUnit || '',
                commonName: '',
                access: true,
              }
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
            history: eventJs.contractName,
            VM: 'SolidVM',
        },
        name: eventJs.contractName,
        label: `Event-${util.uid()}-chain`,
    };

    const contractArgs = {
        name: eventJs.contractName,
    }

    const copyOfOptions = {
        ...options,
        history: [eventJs.contractName],
    };
    
    let error = [];


    if (error.length) {
        throw new Error(error.join('\n'));
    }

    const chainId = await rest.createChain(user, chainArgs, contractArgs, copyOfOptions);
    const waitOptions = { 
        ...options, 
        chainIds: [chainId],
    }
    const response = await waitForAddress(user, { address: constants.governanceAddress, name: eventJs.contractName }, waitOptions);

    return eventJs.bindAddress(user, constants.governanceAddress, { ...options, chainIds: [chainId] });
}

export default {
    createEvent,
}
