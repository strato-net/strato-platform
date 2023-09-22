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
    const batchSize = 200; // Set the desired batch size. Can adjust to optimize performance (max 374)
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
            gteValue: 0
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
    const { quantity, pricePerUnit, range = [], ...restArgs } = args;

    const products = await productJs.getAll(admin, {
        isActive: true,
        isDeleted: false,
        isInventoryAvailable: true,
        ...restArgs
    }, options);

    const productIds = products.map(product => product.address);
    const batchSize = 200; // Set the desired batch size
    const inventoryPromises = [];

    for (let i = 0; i < productIds.length; i += batchSize) {
        const batchProductIds = productIds.slice(i, i + batchSize);

        const inventoryPromise = inventoryJs.getAll(admin, {
            appChainId: args.appChainId,
            status: inventoryStatus.PUBLISHED,
            productId: batchProductIds,
            range,
            gteField: 'availableQuantity',
            gteValue: 1,
            sort: '-createdDate',
            offset: args.offset,
            limit: constants.TOP_SELLING_GET_LIMIT
        }, options);

    // Inventory for membership
    for (let i = 0; i < productsWithMembershipsMap.size; i += batchSize) {
        const batch = Array.from(productsWithMembershipsMap.keys()).slice(i, i + batchSize);
        inventoryWithMembershipPromises.push(
            await inventoryJs.getAll(admin, {
                appChainId: args.appChainId,
                status: inventoryStatus.PUBLISHED,
                productId: batch,
                range,
                gteField: 'availableQuantity',
                gteValue: 0,
                sort: '-createdDate',
                offset: args.offset,
            }, options)
        );
    }

    // Inventory for non membership
    for (let i = 0; i < productsWithoutMembershipsMap.size; i += batchSize) {
        const batch = Array.from(productsWithoutMembershipsMap.keys()).slice(i, i + batchSize);
        inventoryWithoutMembershipPromises.push(
            await inventoryJs.getAll(admin, {
                appChainId: args.appChainId,
                status: inventoryStatus.PUBLISHED,
                productId: batch,
                range,
                gteField: 'availableQuantity',
                gteValue: 0,
                sort: '-createdDate',
                offset: args.offset,
            }, options)
        );
    }

    const inventoryWithMembershipResults = inventoryWithMembershipPromises // await Promise.all(inventoryWithMembershipPromises);
    const inventoryWithoutMembershipResults = inventoryWithoutMembershipPromises // await Promise.all(inventoryWithoutMembershipPromises);

    // Combine inventory and products for non membership products
    const productWithoutMembership = [];
    inventoryWithoutMembershipResults.forEach((inventoryBatch, batchIx) => {
        inventoryBatch.forEach(inventory => {
            const product = productsWithoutMembershipsMap.get(inventory.productId);
            productWithoutMembership.push({
                ...product,
                ...inventory,
            });
        });
    });

    // Inventory with Memberships need membershipServices and Services data
    // Fetch membershipServices and Services in parallel

    // Fetch all memberships using the product address
    const productIds = Array.from(productsWithMembershipsMap.keys());
    const memberships = await membershipJs.getAll(admin, { productId: productIds }, options);

    // map the membership address to the membership object
    const membershipMap = new Map(memberships.map(membership => [membership.productId, membership]));

    // Fetch all membershipServices using the membership address
    const membershipIds = memberships.map(membership => membership.address);
    const allMembershipServices = await membershipServiceJs.getAll(admin, { membershipId: membershipIds }, options);

    // fetch all services
    const services = await serviceJs.getAll(admin, {}, options);
    // map the service address to the service object
    const serviceMap = new Map(services.map(service => [service.address, service]));

    const productWithMembership = [];
    inventoryWithMembershipResults.forEach((inventoryBatch, batchIx) => {
        inventoryBatch.forEach(inventory => {
            // Find the product for this inventory
            const product = productsWithMembershipsMap.get(inventory.productId);
            
            // Find the membership for this product
            const membership = membershipMap.get(product.address);

            // Get all the membership services for this membership
            const membershipServices = allMembershipServices.filter(service => service.membershipId === membership.address);

            // Build the service data for each membership service
            const membershipData = {
                services: membershipServices.map(service => {
                    const servicePrice = serviceMap.get(service.serviceId)?.price || 0;
                    const serviceDiscount = calculateServiceDiscount(servicePrice, service.membershipPrice, service.maxQuantity);

                    return {
                        ...service,
                        servicePrice,
                        serviceDiscount
                    };
                }),
            }
        });
    });

    return inventoriesWithProductInfo.map(inventory => marshalOut(inventory));
}


export default {
    getAll,
    getTopSellingProducts,
    marshalIn,
    marshalOut
}
