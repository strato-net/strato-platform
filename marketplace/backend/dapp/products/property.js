import { util, rest, importer } from '/blockapps-rest-plus';
import config from '/load.config';
import RestStatus from 'http-status-codes';
import { setSearchQueryOptions, searchOne, searchAll, searchAllWithQueryArgs } from '/helpers/utils';
import dayjs from 'dayjs';

const contractName = 'Property_0_4';
const contractFilename = `${util.cwd}/dapp/products/contracts/Property.sol`;
/** 
 * Upload a new Product 
 * @param user User token (typically an admin)
 * @param _constructorArgs Arguments of Product's constructor
 * @param options  deployment options (found in _/config/*.config.yaml_ via _load.config.js_) 
 * @returns Contract object
 * */
async function uploadContract(user, _constructorArgs, options) {

    const contractArgs = {
        name: contractName,
        source: await importer.combine(contractFilename),
        args: util.usc(_constructorArgs),
    };

    let error = [];

    if (error.length) {
        throw new Error(error.join('\n'));
    }

    const copyOfOptions = {
        ...options,
        history: contractName
    }

    const contract = await rest.createContract(user, contractArgs, copyOfOptions);
    contract.src = 'removed';

    return bind(user, contract, copyOfOptions);
}

/**
 * Augment contract arguments before they are used to post a contract.
 * Its counterpart is {@link marshalOut `marshalOut`}.
 * 
 * As our arguments come into the product contract they first pass through `marshalIn` and 
 * when we retrieve contract state they pass through {@link marshalOut `marshalOut`}.
 * 
 * (A mathematical analogy: `marshalIn` and {@link marshalOut `marshalOut`} form something like a 
 * homomorphism) 
 * @param args - Contract state 
 */
function marshalIn(_args) {
    const defaultArgs = {
        productId: '',
        propertType: '',
        listPrice: 0,
        streetNumber: 0,
        streetName: '',
        unitNumber: '',
        postalCity: '',
        stateOrProvince: '',
        postalcode: 0,
        bathroomsTotalInteger: 0,
        bedroomsTotal: 0,
        standardStatus: '',
        lotSizeArea: 0,
        lotSizeUnits: '',
        livingArea: 0,
        livingAreaUnits: '',
        latitude: '',
        longitude: '',
        numberOfUnitsTotal: 0,
        // Appliances
        dishwasher: false,
        dryer: false,
        freezer: false,
        garbageDisposal: false,
        microwave: false,
        ovenOrRange: false,
        refrigerator: false,
        washer: false,
        waterHeater: false,

        // Cooling
        centralAir: false,
        evaporative: false,
        geoThermal: false,
        refrigeration: false,
        solar: false,
        wallUnit: false,

        // Heating
        baseboard: false,
        forceAir: false,
        geoThermalHeat: false,
        heatPump: false,
        hotWater: false,
        radiant: false,
        solarHeat: false,
        steam: false,

        // Flooring
        carpet: false,
        concrete: false,
        hardwood: false,
        laminate: false,
        linoleumVinyl: false,
        slate: false,
        softwood: false,
        tile: false,

        // Parking
        carport: false,
        garage: false,
        offStreet: false,
        onStreet: false,

        // Interior Features
        attic: false,
        cableReady: false,
        ceilingFan: false,
        doublePaneWindows: false,
        elevator: false,
        fireplace: false,
        flooring: false,
        furnished: false,
        jettedTub: false,
        securitySystem: false,
        vaultedCeiling: false,
        skylight: false,
        wetBar: false,

        // Exterior Features
        barbecueArea: false,
        deck: false,
        dock: false,
        fence: false,
        garden: false,
        hotTubOrSpa: false,
        lawn: false,
        patio: false,
        pond: false,
        pool: false,
        porch: false,
        rvParking: false,
        sauna: false,
        sprinklerSystem: false,
        waterFront: false,

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
    }

    const copyOfOptions = {
        ...options,
        query: {
            address: `eq.${address}`,
        },
        chainIds: [chainId]
    }

    const history = await rest.search(user, contractArgs, copyOfOptions)
    return history
}

/**
 * Augment returned contract state before it is returned.
 * Its counterpart is {@link marshalIn `marshalIn`}.
 * 
 * As our arguments come into the product contract they first pass through {@link marshalIn `marshalIn`} 
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
 * Bind functions relevant for product to the _contract object. 
 * @param user User token
 * @param _contract Contract object from `rest.createContract()` etc.
 * @param options Product deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
 */


function bind(user, _contract, options) {
    const contract = { ..._contract };

    contract.get = async (args = { address: contract.address }) => get(user, args, options);
    contract.getState = async () => getState(user, contract, options);
    contract.getHistory = async (args, options = contractOptions) => getHistory(user, chainId, args, options);
    contract.chainIds = options.chainIds;

    return contract;
}

/** 
 * Bind an existing Product contract to a new user token. Useful for having multiple users test
 * the same contract.
 * @example <caption>Create an admin and user bound to the same new product contract.</caption>
 * const adminBoundContract = uploadContract(adminToken, args, options);
 * const userBoundContract = bindAddress(userToken, adminBoundContract.address, options);
 * @param user User token
 * @param address Address of the Product contract
 * @param options Product deployment options (found in _/config/*.config.yaml_ via _load.config.js_)
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
 * @param args Lookup with an address or uniqueProductID.
 * @returns Contract state in cirrus
 */



async function get(user, args, options) {
    const { uniqueProductID, address, ...restArgs } = args;
    let product;
    console.log('productJS',uniqueProductID, address)
    if (address) {
        const searchArgs = setSearchQueryOptions(restArgs, { key: 'address', value: address });
        product = await searchOne(contractName, searchArgs, options, user);
    } else {
        const searchArgs = setSearchQueryOptions(restArgs, { key: 'uniqueProductID', value: uniqueProductID });
        product = await searchOne(contractName, searchArgs, options, user);
    }
    if (!product) {
        return undefined;
    }


    return marshalOut({
        ...product,
    });
}

async function getAll(admin, args = {}, options) {
    const products = await searchAllWithQueryArgs(contractName, args, options, admin)
    return products.map((product) => marshalOut(product))
}

/**
 * Get contract state in bloc.
 * @deprecated Use {@link get `get`} instead.
 */
async function getState(user, contract, options) {
    const state = await rest.getState(user, contract, options);
    return marshalOut(state);
}

export default {
    uploadContract,
    contractName,
    contractFilename,
    bindAddress,
    get,
    getAll,
    marshalIn,
    marshalOut,
    getHistory
}
