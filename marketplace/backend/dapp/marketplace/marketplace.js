import { util, rest, importer } from '/blockapps-rest-plus';
import config from '/load.config';
import RestStatus from 'http-status-codes';
import { setSearchQueryOptions, searchOne, searchAll, searchAllWithQueryArgs } from '/helpers/utils';
import dayjs from 'dayjs';

import productJs from '/dapp/products/product'
import inventoryJs from '/dapp/products/inventory'
import constants, { inventoryStatus } from '/helpers/constants'

/**
 * Augment contract arguments before they are used to post a contract.
 * Its counterpart is {@link marshalOut `marshalOut`}.
 * 
 * As our arguments come into the inventory contract they first pass through `marshalIn` and 
 * when we retrieve contract state they pass through {@link marshalOut `marshalOut`}.
 * 
 * (A mathematical analogy: `marshalIn` and {@link marshalOut `marshalOut`} form something like a 
 * homomorphism) 
 * @param args - Contract state 
 */
function marshalIn(_args) {
    const defaultArgs = {
        quantity: 0,
        pricePerUnit: 0,
        batchId: '',
        availableQuantity: 0,
        status: '',
        createdDate: 0
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
 * As our arguments come into the inventory contract they first pass through {@link marshalIn `marshalIn`} 
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

async function getAll(admin, args = {}, options) {
    const { quantity, pricePerUnit, productId, range = [], ...restArgs } = args;
    const products = await productJs.getAll(admin, {
        isActive: true,
        isDeleted: false,
        address: productId,
        ...restArgs
    }, options);

    const productIds = products.map(product => product.address);
    const batchSize = 200; // Set the desired batch size. Can adjust to optimize performance.
    const inventoryPromises = [];

    // Break up the productIds into batches, and get the inventory for each batch
    for (let i = 0; i < productIds.length; i += batchSize) {
        const batchProductIds = productIds.slice(i, i + batchSize);

        const inventoryPromise = inventoryJs.getAll(admin, {
            appChainId: args.appChainId,
            status: inventoryStatus.PUBLISHED,
            productId: batchProductIds,
            range,
            gteField: 'availableQuantity',
            gteValue: 1
        }, options);

        inventoryPromises.push(inventoryPromise);
    }

    // Wait for all inventory promises to resolve
    const inventoryResults = await Promise.all(inventoryPromises);
    const inventoriesWithProductInfo = [];

    // Loop through each inventory result and add the product info to the inventory
    inventoryResults.forEach(inventory => {
        inventory.forEach(item => {
            const product = products.find(p => p.address === item.productId);
            if (product) {
                const inventoryWithProductInfo = { ...product, ...item };
                inventoriesWithProductInfo.push(inventoryWithProductInfo);
            }
        });
    });

    return inventoriesWithProductInfo.map(inventory => marshalOut(inventory));
}

async function getTopSellingProducts(admin, args = {}, options) {
    const { quantity, pricePerUnit, range = [], ...restArgs } = args
    
    const inventory = await inventoryJs.getAll(admin, { appChainId: args.appChainId, status: inventoryStatus.PUBLISHED, range, gteField: 'availableQuantity', gteValue: 1, sort: '-createdDate', offset: args.offset, limit: constants.TOP_SELLING_GET_LIMIT }, options);
    const inventoryIds = inventory.map(inventory => inventory.productId)

    // We don't need to pass the offset here to the productJs.getAll function
    delete restArgs.offset

    const products = await productJs.getAll(admin, {
        isActive: true,
        isDeleted: false,
        isInventoryAvailable: true,
        address: inventoryIds,
        ...restArgs
    }, options);
    
    const productIds = products.map(product => product.address);

    let inventoriesWithProductInfo = inventory.filter(inventory => productIds.includes(inventory.productId)).map(inventory => ({
        ...products.find(product => product.address == inventory.productId), ...inventory
    }));

    return inventoriesWithProductInfo.map((inventory) => marshalOut(inventory))
}

export default {
    getAll,
    getTopSellingProducts,
    marshalIn,
    marshalOut
}
