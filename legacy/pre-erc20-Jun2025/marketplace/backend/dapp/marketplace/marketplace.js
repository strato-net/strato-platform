import { util, rest, importer } from '/blockapps-rest-plus';
import config from '/load.config';
import RestStatus from 'http-status-codes';
import {
  setSearchQueryOptions,
  searchOne,
  searchAll,
  searchAllWithQueryArgs,
} from '/helpers/utils';
import dayjs from 'dayjs';

import inventoryJs from '/dapp/products/inventory';
import constants, { inventoryStatus } from '/helpers/constants';

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
  const inventoryResults = await inventoryJs.getAll(
    admin,
    { ...args, isMarketplaceSearch: true, isTrendingSearch: false },
    options
  );
  const inventoryCount = await inventoryJs.inventoryCount(
    admin,
    { ...args },
    options
  );
  return {
    inventoryResults: inventoryResults.map((inventory) =>
      marshalOut(inventory)
    ),
    inventoryCount: inventoryCount,
  };
}

async function getTopSellingProducts(admin, args = {}, options) {
  const inventoryResults = await inventoryJs.getAll(
    admin,
    { ...args, isMarketplaceSearch: true, isTrendingSearch: true },
    options
  );
  return inventoryResults.map((inventory) => marshalOut(inventory));
}

export default {
  getAll,
  getTopSellingProducts,
  marshalIn,
  marshalOut,
};
