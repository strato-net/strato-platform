import { util, rest } from "/blockapps-rest-plus";
import RestStatus from "http-status-codes";
import { setSearchQueryOptions, searchAll } from "/helpers/utils";
import dayjs from "dayjs";

import inventoryJs from "/dapp/products/inventory";
import constants from "/helpers/constants";
import strats from "/dapp/strats/strats";

function marshalOut(_args) {
  const args = {
    ..._args,
  };
  return args;
}

async function getWalletSummary(admin, args = {}, options) {
  const { userAddress } = args;
  const getOptions = { ...options, org: "TestCompany", app: "" };
  const stratsAddress = strats.getStratsAddress();

  const stratsBalanceArgs = {
    address: stratsAddress,
    key: userAddress,
  };

  const stratsBalance = await strats.getStratsBalance(
    admin,
    stratsBalanceArgs,
    getOptions
  );

  // add more summary information here if needed

  return { stratsBalance };
}

async function getWalletAssets(admin, args = {}, options) {
  const { userCommonName } = args;
  const getOptions = { ...options, app: constants.contractName };

  const inventoryResults = await inventoryJs.getAll(
    admin,
    { ownerCommonName: userCommonName },
    getOptions
  );
  const inventoryCount = await inventoryJs.inventoryCount(
    admin,
    { ownerCommonName: userCommonName },
    getOptions
  );

  return {
    assets: inventoryResults.map((inventory) => marshalOut(inventory)),
    assetCount: inventoryCount,
  };
}

export default {
  getWalletSummary,
  getWalletAssets,
  marshalOut,
};
