import { util, rest, importer } from "/blockapps-rest-plus";
import config from "/load.config";
import RestStatus from "http-status-codes";
import {
  setSearchQueryOptions,
  searchOne,
  searchAll,
  searchAllWithQueryArgs,
} from "/helpers/utils";
import dayjs from "dayjs";

import productJs from "/dapp/products/product";
import inventoryJs from "/dapp/products/inventory";
import membershipJs from "/dapp/membership/membership";
import membershipServiceJs from "../membershipService/membershipService";
import serviceJs from "../service/service";
import constants, { inventoryStatus } from "/helpers/constants";

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
    batchId: "",
    availableQuantity: 0,
    status: "",
    createdDate: 0,
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
    const { range = [], ...restArgs } = args;

    // Fetch all products, memberships, membership services, and services in parallel
    const [products, memberships, membershipServices, services] = await Promise.all([
        productJs.getAll(admin, {
            isActive: true,
            isDeleted: false,
            isInventoryAvailable: true,
            ...restArgs
        }, options),
        membershipJs.getAll(admin, { productId: null }, options),
        membershipServiceJs.getAll(admin, { membershipId: null }, options),
        serviceJs.getAll(admin, { address: null }, options)
    ]);

    const productMap = new Map(products.map(product => [product.address, product]));

    const membershipMap = new Map(memberships.map(membership => [membership.productId, membership]));

    const membershipServiceMap = membershipServices.reduce((acc, service) => {
        if (!acc[service.membershipId]) {
            acc[service.membershipId] = [];
        }
        acc[service.membershipId].push(service);
        return acc;
    }, {});

    const serviceMap = new Map(services.map(service => [service.address, service]));

    // Fetch inventory for each product in parallel
    const inventoryPromises = products.map(product => {
        return inventoryJs.getAll(admin, {
            appChainId: args.appChainId,
            status: inventoryStatus.PUBLISHED,
            productId: product.address,
            range,
            gteField: 'availableQuantity',
            gteValue: 1,
            sort: '-createdDate',
            offset: args.offset,
            limit: constants.TOP_SELLING_GET_LIMIT
        }, options);
    });

    const inventoryResults = await Promise.all(inventoryPromises);

    const returnObject = [];

    function calculateServiceDiscount(servicePrice, membershipPrice, maxQuantity) {
        return (servicePrice - membershipPrice) * maxQuantity;
    }

    function calculateTotalSavings(services) {
        return services.reduce((total, service) => total + service.serviceDiscount, 0);
    }

    // Process inventory results and create the return object
    inventoryResults.forEach((inventoryBatch, batchIx) => {
        inventoryBatch.forEach(inventory => {
            const product = productMap.get(inventory.productId);
            const membership = membershipMap.get(product.address);

            const membershipServices = membershipServiceMap[membership.address] || [];

            const membershipData = {
                ...membership,
                services: membershipServices.map(service => {
                    const servicePrice = serviceMap.get(service.serviceId)?.price || 0;
                    const serviceDiscount = calculateServiceDiscount(servicePrice, service.membershipPrice, service.maxQuantity);

                    return {
                        ...service,
                        servicePrice,
                        serviceDiscount
                    };
                }),
            };

            const totalSavings = calculateTotalSavings(membershipData.services);

            membershipData.totalSavings = totalSavings;

            returnObject.push({
                ...product,
                ...inventory,
                totalSavings: totalSavings,
            });
        });
    });

    return returnObject.map(inventory => marshalOut(inventory));
}


async function getTopSellingProducts(admin, args = {}, options) {
    const { quantity, pricePerUnit, range = [], ...restArgs } = args;

    const products = await productJs.getAll(admin, {
        isActive: true,
        isDeleted: false,
        isInventoryAvailable: true,
        ...restArgs
    }, options);

    const productDictionary = products.reduce((acc, product) => {
        acc[product.address] = product;
        return acc;
    }, {});

    const productIds = products.map(product => product.address);
    const batchSize = 200;
    const inventoryPromises = [];
    const membershipPromise = membershipJs.getAll(admin, { productId: productIds }, options);

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

        inventoryPromises.push(inventoryPromise);
    }

    const [inventoryResults, memberships] = await Promise.all([Promise.all(inventoryPromises), membershipPromise]);

    const membershipMap = memberships.reduce((acc, membership) => {
        acc[membership.productId] = membership;
        return acc;
    }, {});

    const returnObject = inventoryResults[0].map(inventory => {
        const product = productDictionary[inventory.productId];
        const membership = membershipMap[product.address];

        return {
            ...product,
            ...inventory,
            membership: membership
        };
    });

    return returnObject.map(inventory => marshalOut(inventory));
}



export default {
  getAll,
  getTopSellingProducts,
  marshalIn,
  marshalOut,
};
