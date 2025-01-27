import { rest, util, importer } from 'blockapps-rest';
const { createContract } = rest;
import constants, {
  calculatePriceFluctuation,
  calculateAverageSalePrice,
  calculateVolumeTraded,
  getOneYearAgoTime,
  getSixMonthsAgoTime,
  getDate,
  timeFilterForAll,
  timeFilterForOneYear,
  timeFilterForSixMonths,
  ASSET_STATUS,
  REDEMPTION_STATUS,
  DEFAULT_COMMENT,
} from '/helpers/constants';
import { yamlWrite, yamlSafeDumpSync, getYamlFile } from '/helpers/config';
import { pollingHelper } from '/helpers/utils';

import axios from 'axios';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import RestStatus from 'http-status-codes';
import BigNumber from 'bignumber.js';

import certificateJs from '/dapp/certificates/certificate';

import artJs from '/dapp/items/art';
import tokensJs from '/dapp/items/tokens';
import carbonOffsetJs from '/dapp/items/carbonOffset';
import metalsJs from '/dapp/items/metals';
import spiritsJs from '/dapp/items/spirits';
import clothingJs from '/dapp/items/clothing';
import membershipJs from '/dapp/items/membership';
import carbonDAOJs from '/dapp/items/carbonDAO';
import collectibleJs from 'dapp/items/collectibles';

import saleJs from '/dapp/orders/sale';
import saleOrderJs from '/dapp/orders/saleOrder';

import inventoryJs from '/dapp/products/inventory';
import marketplaceJs from '/dapp/marketplace/marketplace.js';
import paymentServiceJs from '/dapp/payments/paymentService';
import redemptionServiceJs from '/dapp/redemptions/redemptionService';
import reserveJs from '/dapp/reserve/reserve';
import escrowJs from '/dapp/escrow/escrow';

const allAssetNames = [];
dayjs.extend(utc);
const contractName = 'Mercata';
const contractFileName = `dapp/mercata-base-contracts/BaseCodeCollection.sol`;

const balance = 100000000000000000000;
let userCert = null;

// interface Member {
//   access?:boolean,
//   orgName?:string,
//   orgUnit?:string,
//   commonName?:string
// }

function deploy(contract, args, options) {
  // author the deployment
  const { deployFilePath } = args;

  const deployment = {
    url: options.config.nodes[0].url,
    dapp: {
      contract: {
        name: contract.name,
        address: contract.address,
      },
    },
  };

  if (options.config.apiDebug) {
    console.log('deploy filename:', deployFilePath);
    console.log(yamlSafeDumpSync(deployment));
  }

  yamlWrite(deployment, deployFilePath);

  return deployment;
}

async function loadFromDeployment(admin, deployFilename, options) {
  const deployFile = getYamlFile(deployFilename);
  return await bind(admin, deployFile.dapp.contract, {
    ...options,
  });
}

async function uploadDappContract(token, options) {
  const source = await importer.combine(contractFileName);
  const contractArgs = {
    name: contractName,
    source,
    args: {},
  };

  const copyOfOptions = {
    ...options,
    history: [contractName, ...allAssetNames],
  };

  const contract = await createContract(token, contractArgs, copyOfOptions);
  contract.src = 'removed';

  return await bind(token, contract, options);
}

async function uploadContract(token, options) {
  const source = await importer.combine(contractFileName);
  const contractArgs = {
    name: contractName,
    source,
    args: {},
  };

  const copyOfOptions = {
    ...options,
    history: [contractName],
  };

  const contract = await createContract(token, contractArgs, options);
  contract.src = 'removed';

  return await bind(token, contract, options);
}

async function bind(rawAdmin, _contract, _defaultOptions, serviceUser = false) {
  const contract = _contract;
  let userOrganization;
  let userCommonName;

  if (!serviceUser) {
    let userCertificate = await pollingHelper(certificateJs.getCertificateMe, [
      rawAdmin,
    ]);

    //We are not guaranteed the user will have a certificate
    //99% chance they do, but if this this their first login
    //the node might not have a certificate in time
    if (
      !(
        userCertificate === null ||
        userCertificate === undefined ||
        userCertificate.commonName === null ||
        userCertificate.commonName === undefined
      )
    ) {
      contract.userOrganization = userCertificate.organization;
      userOrganization = userCertificate.organization;
      userCommonName = userCertificate.commonName;
      userCert = userCertificate; //Attaching user cert to dapp to save from needing make another call to get it
    }
  }

  // includes the org+app for cirrus namespacing (helpers/utils.js will prepend to cirrus queries)
  const defaultOptions = {
    ..._defaultOptions,
    app: contractName,
    chainIds: [],
    cacheNonce: true,
  };
  // for querying data not on the dapp shard
  const optionsNoChainIds = {
    ...defaultOptions,
    chainIds: [],
  };

  const admin = { ...rawAdmin };

  // --------------------------- DAPP MANAGEMENT --------------------------------
  // governance - single add
  contract.addOrg = async function (orgName) {
    return addOrg(admin, contract, defaultOptions, orgName);
  };
  contract.addOrgUnit = async function (orgName, orgUnit) {
    return addOrgUnit(admin, contract, defaultOptions, orgName, orgUnit);
  };
  contract.addMember = async function (orgName, orgUnit, commonName) {
    return addMember(
      admin,
      contract,
      defaultOptions,
      orgName,
      orgUnit,
      commonName
    );
  };
  contract.removeOrg = async function (orgName) {
    return removeOrg(admin, contract, defaultOptions, orgName);
  };
  contract.removeOrgUnit = async function (orgName, orgUnit) {
    return removeOrgUnit(admin, contract, defaultOptions, orgName, orgUnit);
  };
  contract.removeMember = async function (orgName, orgUnit, commonName) {
    return removeMember(
      admin,
      contract,
      defaultOptions,
      orgName,
      orgUnit,
      commonName
    );
  };

  // governance - multiple adds
  contract.addOrgs = async function (orgNames) {
    return addOrgs(admin, contract, defaultOptions, orgNames);
  };
  contract.addOrgUnits = async function (orgNames, orgUnits) {
    return addOrgUnits(admin, contract, defaultOptions, orgNames, orgUnits);
  };
  contract.addMembers = async function (orgNames, orgUnits, commonNames) {
    return addMembers(
      admin,
      contract,
      defaultOptions,
      orgNames,
      orgUnits,
      commonNames
    );
  };
  contract.removeOrgs = async function (orgNames) {
    return removeOrgs(admin, contract, defaultOptions, orgNames);
  };
  contract.removeOrgUnits = async function (orgNames, orgUnits) {
    return removeOrgUnits(admin, contract, defaultOptions, orgNames, orgUnits);
  };
  contract.removeMembers = async function (orgNames, orgUnits, commonNames) {
    return removeMembers(
      admin,
      contract,
      defaultOptions,
      orgNames,
      orgUnits,
      commonNames
    );
  };

  // state and deployment
  contract.getState = async function () {
    return rest.getState(admin, contract, defaultOptions);
  };
  contract.deploy = function (args, options = defaultOptions) {
    const deployment = deploy(contract, args, options);
    return deployment;
  };

  // -------------------------- CERTIFICATES --------------------------------
  contract.getCertificate = async function (args) {
    return certificateJs.getCertificate(admin, args);
  };
  contract.getCertificateMe = !(userCert === null || userCert === undefined)
    ? userCert
    : async function () {
        return certificateJs.getCertificateMe(admin);
      };
  contract.getCertificates = async function (args) {
    return certificateJs.getCertificates(admin, args);
  };
  contract.requestReview = async function (args) {
    return certificateJs.requestReview(admin, args);
  };
  contract.authorizeIssuer = async function (args) {
    return certificateJs.authorizeIssuer(admin, args);
  };
  contract.deauthorizeIssuer = async function (args) {
    return certificateJs.deauthorizeIssuer(admin, args);
  };
  contract.setIsAdmin = async function (args) {
    return certificateJs.setIsAdmin(admin, args);
  };

  // -------------------------- INVENTORY --------------------------------

  contract.getInventory = async function (args, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName };
    return await inventoryJs.get(rawAdmin, { ...args }, getOptions);
  };

  contract.getInventories = async function (args, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName };

    const inventories = await inventoryJs.getAll(
      rawAdmin,
      { ...args, ownerCommonName: userCert.commonName, sort: '-createdDate' },
      getOptions
    );
    const inventoryCount = await inventoryJs.inventoryCount(
      rawAdmin,
      { ...args, ownerCommonName: userCert.commonName, sort: '-createdDate' },
      getOptions
    );
    return { inventories: inventories, inventoryCount: inventoryCount };
  };

  contract.getAllInventories = async function (
    args,
    options = optionsNoChainIds
  ) {
    const getOptions = { ...options, app: contractName };
    const inventories = await inventoryJs.getAll(
      rawAdmin,
      { ...args, sort: '-createdDate' },
      getOptions
    );
    const inventoryCount = await inventoryJs.inventoryCount(
      rawAdmin,
      { ...args, sort: '-createdDate' },
      getOptions
    );
    return { inventories: inventories, inventoryCount: inventoryCount };
  };

  contract.getInventoriesForUser = async function (
    args,
    options = optionsNoChainIds
  ) {
    const { user,...restArgs } = args;
    const getOptions = { ...options, app: contractName };
    const newArgs = {
      ...restArgs,
      ownerCommonName: user || userCert?.commonName,
      notEqualsField: 'sale',
      notEqualsValue: constants.zeroAddress,
      userProfile: true,
    };

    return marketplaceJs.getAll(rawAdmin, newArgs, getOptions);
  };

  contract.getOwnershipHistory = async function (
    args,
    options = optionsNoChainIds
  ) {
    return await inventoryJs.getOwnershipHistory(rawAdmin, args, options);
  };

  contract.listItem = async function (args, options = defaultOptions) {
    return await inventoryJs.uploadSaleContract(rawAdmin, args, options);
  };

  contract.unlistItem = async function (args, options = defaultOptions) {
    const { saleAddress, ...restArgs } = args;
    const contract = { address: saleAddress };
    return await inventoryJs.unlistItem(rawAdmin, contract, restArgs, options);
  };

  contract.resellItem = async function (args, options = defaultOptions) {
    const { assetAddress, ...restArgs } = args;
    const contract = { address: assetAddress };
    return await inventoryJs.resellItem(rawAdmin, contract, restArgs, options);
  };

  contract.transferItem = async function (args, options = defaultOptions) {
    const finalArgs = args.map((arg) => {
      const { assetAddress, ...restArgs } = arg;
      const transferNumber = parseInt(util.uid());
      const contract = { address: assetAddress };
      return {
        contract: contract,
        transferNumber: transferNumber,
        ...restArgs,
      };
    });
    return inventoryJs.transferItem(rawAdmin, finalArgs, options);
  };

  contract.getAllItemTransferEvents = function (
    args,
    options = defaultOptions
  ) {
    const getOptions = { ...options, app: contractName };
    return inventoryJs.getAllItemTransferEvents(rawAdmin, args, getOptions);
  };

  contract.updateSale = async function (args, options = defaultOptions) {
    const { saleAddress, ...restArgs } = args;
    const contract = { address: saleAddress };
    return await inventoryJs.updateSale(rawAdmin, contract, restArgs, options);
  };

  contract.updateInventory = async function (args, options = defaultOptions) {
    const { itemContract, itemAddress, ...restArgs } = args;
    const contract = { name: itemContract, address: itemAddress };
    return await inventoryJs.updateInventory(
      rawAdmin,
      contract,
      restArgs,
      options
    );
  };

  contract.getRedemptionServices = async function (
    args,
    options = defaultOptions
  ) {
    const redemptionServices = await redemptionServiceJs.getAll(
      rawAdmin,
      args,
      options
    );
    return redemptionServices;
  };

  contract.requestRedemption = async function (args, options = defaultOptions) {
    const { assetAddresses, redemptionService, quantity, ...restArgs } = args;

    const contract = { address: assetAddresses[0] };
    const redemptionId = util.uid();
    const contractArgs = { quantity, redemptionId };
    const [requestRedemptionStatus, assetAddress] =
      await inventoryJs.requestRedemption(
        rawAdmin,
        contract,
        contractArgs,
        options
      );

    const finalArgs = {
      redemption_id: parseInt(redemptionId),
      assetAddresses: [assetAddress],
      quantity,
      ...restArgs,
    };

    if (requestRedemptionStatus) {
      try {
        const { serviceURL, createRedemptionRoute = '' } =
          await redemptionServiceJs.get(
            rawAdmin,
            { address: redemptionService },
            options
          );
        await axios
          .post(new URL(createRedemptionRoute, serviceURL).href, {
            ...finalArgs,
          })
          .then(function (res) {
            if (res.status === 200) {
              console.log(res.data);
            } else {
              throw new rest.RestError(
                RestStatus.BAD_REQUEST,
                `Payment server call failed: ${res.statusText}`
              );
            }
          });
        return {};
      } catch (error) {
        // The AssetStaus is initially switched to PENDING_REDEMPTION but must be reverted if Redemption creation fails
        const [updateStatus] = await inventoryJs.updateAssetStatus(
          rawAdmin,
          { address: assetAddress },
          { status: ASSET_STATUS.ACTIVE },
          options
        );

        if (error.response) {
          throw new rest.RestError(
            error.response.status,
            error.response.statusText
          );
        }
        throw new rest.RestError(
          RestStatus.BAD_REQUEST,
          `Error while creating redemption record: ${JSON.stringify(error)} `
        );
      }
    }
  };

  contract.getOutgoingRedemptionRequests = async function (
    args,
    options = optionsNoChainIds
  ) {
    const { order, search, range, limit, offset } = args;
    const queryParams = new URLSearchParams({
      redemptionId: search,
      order: order,
      limit,
      offset,
    }).toString();

    try {
      let redemptions = [];
      let redemptionServiceAddresses = [];
      let count = 0;
      const redemptionEvents = await redemptionServiceJs.getRedemptions(
        rawAdmin,
        { owner: userCert.commonName },
        options
      );
      redemptionEvents.map((r) => {
        if (!redemptionServiceAddresses.includes(r.address)) {
          redemptionServiceAddresses.push(r.address);
        }
      });
      let redemptionServices = await redemptionServiceJs.getAll(
        rawAdmin,
        { address: redemptionServiceAddresses },
        options
      );

      // handle backwards compatibility case
      if (Object.keys(redemptionServices).length === 0) {
        redemptionServices = await redemptionServiceJs.getAll(
          rawAdmin,
          { isActive: true, ownerCommonName: 'Server' },
          options
        );
      }

      const redemptionPromises = redemptionServices.map(async (rs) => {
        const serviceUrl = rs.serviceURL || rs.data.serviceURL;
        const getOutgoingRedemptionRoute =
          rs.outgoingRedemptionsRoute || rs.data.outgoingRedemptionsRoute;
        let res = await axios.get(
          new URL(
            `${serviceUrl}${getOutgoingRedemptionRoute}/${userCert.commonName}?${queryParams}`
          ).href
        );
        if (res.status === 200) {
          count = res.data.count;
          return res.data.data.map((item) => {
            const date = new Date(item.createdDate);
            const unixTimestamp = Math.floor(date.getTime() / 1000);
            return {
              ...item,
              redemptionDate: unixTimestamp,
              type: 'Redemption',
              block_timestamp: new Date(item.createdDate),
            };
          });
        } else return [];
      });

      const allRedemptions = await Promise.all(redemptionPromises);
      redemptions = allRedemptions.flat();
      if (range?.length) {
        redemptions = redemptions.filter((item) => {
          const dateRange = range[0].split(',');
          const startRange = dateRange[1];
          const endRange = dateRange[2];
          if (
            item.redemptionDate > startRange &&
            item.redemptionDate < endRange
          ) {
            return item;
          }
        });
      }

      if (order && order === 'ASC')
        redemptions.sort((a, b) => a.createdDate - b.createdDate);
      else redemptions.sort((a, b) => b.createdDate - a.createdDate);

      return { data: redemptions, count };
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(
          error.response.status,
          error.response.statusText
        );
      }
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        `Error while fetching outgoing redemptions: ${JSON.stringify(error)} `
      );
    }
  };

  contract.getIncomingRedemptionRequests = async function (
    args,
    options = optionsNoChainIds
  ) {
    const { order, search, range, limit, offset } = args;
    const queryParams = new URLSearchParams({
      redemptionId: search,
      order: order,
      limit,
      offset,
    }).toString();

    try {
      let redemptions = [];
      let count = 0;
      const redemptionEvents = await redemptionServiceJs.getRedemptions(
        rawAdmin,
        { issuer: userCert.commonName },
        options
      );
      const redemptionServiceAddresses = redemptionEvents.map((r) => r.address);
      let redemptionServices = await redemptionServiceJs.getAll(
        rawAdmin,
        { address: redemptionServiceAddresses },
        options
      );

      // handle backwards compatibility case
      if (Object.keys(redemptionServices).length === 0) {
        redemptionServices = await redemptionServiceJs.getAll(
          rawAdmin,
          { isActive: true, ownerCommonName: 'Server' },
          options
        );
      }

      const redemptionPromises = redemptionServices.map(async (rs) => {
        const serviceUrl = rs.serviceURL || rs.data.serviceURL;
        const getIncomingRedemptionRoute =
          rs.incomingRedemptionsRoute || rs.data.incomingRedemptionsRoute;
        const res = await axios.get(
          new URL(
            `${serviceUrl}${getIncomingRedemptionRoute}/${userCert.commonName}?${queryParams}`
          ).href
        );
        if (res.status === 200) {
          count = res.data.count;
          return res.data.data.map((item) => {
            const date = new Date(item.createdDate);
            const unixTimestamp = Math.floor(date.getTime() / 1000);
            return {
              ...item,
              redemptionDate: unixTimestamp,
              type: 'Redemption',
              block_timestamp: new Date(item.createdDate),
            };
          });
        } else {
          return [];
        }
      });

      const allRedemptions = await Promise.all(redemptionPromises);
      redemptions = allRedemptions.flat();
      if (range?.length) {
        redemptions = redemptions.filter((item) => {
          const dateRange = range[0].split(',');
          const startRange = dateRange[1];
          const endRange = dateRange[2];
          if (
            item.redemptionDate > startRange &&
            item.redemptionDate < endRange
          ) {
            return item;
          }
        });
      }

      if (order && order === 'ASC')
        redemptions.sort((a, b) => a.createdDate - b.createdDate);
      else redemptions.sort((a, b) => b.createdDate - a.createdDate);

      return { data: redemptions, count };
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(
          error.response.status,
          error.response.statusText
        );
      }
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        `Error while fetching incoming redemptions: ${JSON.stringify(error)} `
      );
    }
  };

  contract.getAllRedemptionRequests = async function (
    args,
    options = optionsNoChainIds
  ) {
    const { order, search, range, limit, offset } = args;
    const queryParams = new URLSearchParams({
      redemptionId: search,
      order: order,
      limit,
      offset,
    }).toString();

    try {
      let redemptions = [];
      let count = 0;
      const redemptionEvents = await redemptionServiceJs.getRedemptions(
        rawAdmin,
        { limit },
        options
      );
      const redemptionServiceAddresses = redemptionEvents.map((r) => r.address);
      let redemptionServices = await redemptionServiceJs.getAll(
        rawAdmin,
        { address: redemptionServiceAddresses },
        options
      );

      // handle backwards compatibility case
      if (Object.keys(redemptionServices).length === 0) {
        redemptionServices = await redemptionServiceJs.getAll(
          rawAdmin,
          { isActive: true, ownerCommonName: 'Server', limit },
          options
        );
      }

      const redemptionPromises = redemptionServices.map(async (rs) => {
        const serviceUrl = rs.serviceURL || rs.data.serviceURL;
        const res = await axios.get(
          `${serviceUrl}/redemption/all?${queryParams}`
        );
        if (res.status === 200) {
          count = res.data.count;
          return res.data.data.map((item) => {
            const date = new Date(item.createdDate);
            const unixTimestamp = Math.floor(date.getTime() / 1000);
            return {
              ...item,
              redemptionDate: unixTimestamp,
              type: 'Redemption',
              block_timestamp: new Date(item.createdDate),
            };
          });
        } else {
          return [];
        }
      });

      const allRedemptions = await Promise.all(redemptionPromises);
      redemptions = allRedemptions.flat();
      if (range) {
        redemptions = redemptions.filter((item) => {
          const dateRange = range[0].split(',');
          const startRange = dateRange[1];
          const endRange = dateRange[2];
          if (
            item.redemptionDate > startRange &&
            item.redemptionDate < endRange
          ) {
            return item;
          }
        });
      }

      if (order && order === 'ASC')
        redemptions.sort((a, b) => a.createdDate - b.createdDate);
      else redemptions.sort((a, b) => b.createdDate - a.createdDate);

      return { data: redemptions, count };
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(
          error.response.status,
          error.response.statusText
        );
      }
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        `Error while fetching All redemptions: ${JSON.stringify(error)} `
      );
    }
  };

  contract.getRedemption = async function (args, options = optionsNoChainIds) {
    const { redemptionService } = args;
    try {
      const { serviceURL, getRedemptionRoute = '' } =
        await redemptionServiceJs.get(
          rawAdmin,
          { address: redemptionService },
          options
        );
      const redemption = await axios
        .get(new URL(`${getRedemptionRoute}/${args.id}`, serviceURL).href)
        .then(function (res) {
          if (res.status === 200) {
            return res.data.data;
          } else {
            throw new rest.RestError(
              RestStatus.BAD_REQUEST,
              `Payment server call failed: ${res.statusText}`
            );
          }
        });
      return redemption;
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(
          error.response.status,
          error.response.statusText
        );
      }
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        `Error while fetching redemption details: ${JSON.stringify(error)} `
      );
    }
  };

  contract.closeRedemption = async function (
    args,
    options = optionsNoChainIds
  ) {
    const {
      id,
      assetAddresses,
      redemptionService,
      status,
      issuerCommonName,
      ...restArgs
    } = args;

    let assetStatus;
    if (status === REDEMPTION_STATUS.FULFILLED) {
      assetStatus = ASSET_STATUS.RETIRED;
    } else if (status === REDEMPTION_STATUS.REJECTED) {
      assetStatus = ASSET_STATUS.ACTIVE;
    }

    if (issuerCommonName !== userCert.commonName) {
      throw new rest.RestError(
        RestStatus.UNAUTHORIZED,
        'Only the issuer can close a redemption request'
      );
    }

    const contract = { address: assetAddresses[0] };
    const [updateStatus] = await inventoryJs.updateAssetStatus(
      rawAdmin,
      contract,
      { status: assetStatus },
      options
    );

    const finalArgs = { status, ...restArgs };

    if (updateStatus) {
      try {
        const { serviceURL, closeRedemptionRoute = '' } =
          await redemptionServiceJs.get(
            rawAdmin,
            { address: redemptionService },
            options
          );
        const redemption = await axios
          .put(new URL(`${closeRedemptionRoute}/${id}`, serviceURL).href, {
            ...finalArgs,
          })
          .then(function (res) {
            if (res.status === 200) {
              return res.data.data;
            } else {
              throw new rest.RestError(
                RestStatus.BAD_REQUEST,
                `Payment server call failed: ${res.statusText}`
              );
            }
          });
        return redemption;
      } catch (error) {
        if (error.response) {
          throw new rest.RestError(
            error.response.status,
            error.response.statusText
          );
        }
        throw new rest.RestError(
          RestStatus.BAD_REQUEST,
          `Error while closing redemption: ${JSON.stringify(error)} `
        );
      }
    } else {
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Error while updating Asset Status'
      );
    }
  };

  // ------------------------------ INVENTORY ENDS--------------------------------

  contract.getMarketplaceInventories = async function (
    args = {},
    options = optionsNoChainIds
  ) {
    const getOptions = { ...options, app: contractName };
    //for ba sellers, get all assets - display For Sale and Sold Out
    const newArgs = { ...args, ownerCommonName: constants.baUserNames };
    const all = await marketplaceJs.getAll(rawAdmin, newArgs, getOptions);

    // for non-ba sellers, get assets with valid sale & saleQty > 0 - display only For Sale records
    const newArgs1 = {
      ...args,
      notEqualsField: ['ownerCommonName', 'sale'],
      notEqualsValue: [constants.baUserNames, constants.zeroAddress],
    };
    let all2 = await marketplaceJs.getAll(rawAdmin, newArgs1, getOptions);
    // filter out assets with price <= 0 (This works because we don't have an offset for number of assets)
    all2.inventoryResults = all2.inventoryResults.filter(
      ({ price }) => price > 0
    );
    all2.inventoryCount = all2.inventoryResults.length;

    return {
      inventoryResults: all.inventoryResults.concat(all2.inventoryResults),
      inventoryCount: all.inventoryCount + all2.inventoryCount,
    };
  };

  contract.getMarketplaceInventoriesLoggedIn = async function (
    args = {},
    options = optionsNoChainIds
  ) {
    const getOptions = { ...options, app: contractName };
    let usersArr = constants.baUserNames.filter(
      (user) => user !== userCommonName
    );
    const newArgs = { ...args, ownerCommonName: usersArr };
    const all = await marketplaceJs.getAll(rawAdmin, newArgs, getOptions);

    const newArgs1 = {
      ...args,
      notEqualsField: ['ownerCommonName', 'sale'],
      notEqualsValue: [
        [userCommonName, ...constants.baUserNames],
        constants.zeroAddress,
      ],
    };
    let all2 = await marketplaceJs.getAll(rawAdmin, newArgs1, getOptions);
    // filter out assets with price <= 0 (This works because we don't have an offset for number of assets)
    all2.inventoryResults = all2.inventoryResults.filter(
      ({ price }) => price > 0
    );
    all2.inventoryCount = all2.inventoryResults.length;
    return {
      inventoryResults: all.inventoryResults.concat(all2.inventoryResults),
      inventoryCount: all.inventoryCount + all2.inventoryCount,
    };
  };

  contract.getTopSellingProducts = async function (
    args = {},
    options = optionsNoChainIds
  ) {
    const getOptions = { ...options, app: contractName };
    const newArgs = {
      ...args,
      notEqualsField: 'sale',
      notEqualsValue: constants.zeroAddress,
      ownerCommonName: constants.baUserNames,
    };
    return marketplaceJs.getTopSellingProducts(rawAdmin, newArgs, getOptions);
  };

  contract.getTopSellingProductsLoggedIn = async function (
    args = {},
    options = optionsNoChainIds
  ) {
    const getOptions = { ...options, app: contractName };
    const newArgs = {
      ...args,
      notEqualsField: ['sale', 'ownerCommonName'],
      notEqualsValue: [constants.zeroAddress, userCommonName],
    };
    return marketplaceJs.getTopSellingProducts(rawAdmin, newArgs, getOptions);
  };

  contract.getStakeableProducts = async function (
    args = {},
    options = optionsNoChainIds
  ) {
    const getOptions = { ...options, app: contractName };

    return inventoryJs.getAll(rawAdmin, args, getOptions);
  };

  contract.getPriceHistory = async function (args, options = defaultOptions) {
    try {
      const { assetAddress, timeFilter } = args;

      const assetWithoutQuantity = await inventoryJs.get(
        rawAdmin,
        { address: assetAddress },
        options
      );
      const originAddress = assetWithoutQuantity.originAddress;
      const assetsOfOriginAsset = await inventoryJs.getAll(
        rawAdmin,
        { originAddress: originAddress },
        options
      );
      const assetsAddressArr = assetsOfOriginAsset.map((item) => item.address);
      // Aggregate sales for all associated assets

      const allAssetSales = await saleJs.fetchSalesInBatches(
        rawAdmin,
        {
          assetToBeSold: assetsAddressArr,
          order: 'block_timestamp.asc',
          gtField: 'block_timestamp',
          gtValue: getOneYearAgoTime(),
        },
        options
      );

      // Fetch sales (12 months) for stats
      let salesFilter = { order: 'block_timestamp.asc' };

      // Sales Filter modification based on timeFilter
      if (timeFilter === timeFilterForSixMonths()) {
        // Applying 6-month filter
        salesFilter.gtField = 'block_timestamp';
        salesFilter.gtValue = getSixMonthsAgoTime();
      } else if (timeFilter === timeFilterForOneYear()) {
        //Applying 1-year filter
        salesFilter.gtField = 'block_timestamp';
        salesFilter.gtValue = getOneYearAgoTime();
      } else if (timeFilter === timeFilterForAll()) {
        // For 'All', no changes to salesFilter required
      } else {
        console.log('Invalid timeFilter');
        return;
      }

      const timeRangeSales = await saleJs.fetchSalesInBatches(
        rawAdmin,
        {
          assetToBeSold: assetsAddressArr,
          ...salesFilter,
        },
        options
      );

      // Fetch sales based on filter

      // Process records such that for a given date the most recent sale price is fetched
      // This method processes sales passed, drills down into history table for each sale
      const processSalesHistory = async (
        sales,
        filter = {},
        shouldAggregate = true,
        options = defaultOptions
      ) => {
        // Fetch sale histories in batches using the new fetchSaleHistoriesInBatches function
        const histories = await saleJs.fetchSaleHistoriesInBatches(
          rawAdmin,
          {
            assetToBeSold: sales.map((sale) => sale.assetToBeSold), // Pass assetToBeSold from sales
            filter, // Apply filter
            maxConcurrency: 10, // Number of concurrent requests
          },
          options
        );

        if (shouldAggregate) {
          // Flatten records and aggregate by date, keeping the latest sale record for each date
          return histories.flat().reduce((acc, recordContainer) => {
            Object.values(recordContainer).forEach((record) => {
              const date = getDate(record);
              if (!date) return;
              if (
                !acc[date] ||
                acc[date].block_timestamp < record.block_timestamp
              ) {
                acc[date] = record;
              }
            });
            return acc;
          }, {});
        } else {
          // Return history data without processing
          return histories
            .flat()
            .map((recordContainer) => Object.values(recordContainer))
            .flat();
        }
      };

      // Get the histories
      // Driver to fetch history sales for- plotting data points, stats
      const processedSalesResults = await Promise.allSettled([
        processSalesHistory(timeRangeSales, salesFilter, true), // for data points to be plotted
        processSalesHistory(allAssetSales, {}, false), // for 12-month historical data
      ]);

      // Time Filter Records
      const originRecordsSorted =
        processedSalesResults[0].status === 'fulfilled'
          ? Object.values(processedSalesResults[0].value).sort(
              (a, b) =>
                new Date(a.block_timestamp) - new Date(b.block_timestamp)
            )
          : [];
      // Only send price, timestamp as a part of the record
      const originRecords = originRecordsSorted
        ? Object.values(originRecordsSorted).map(
            ({ price, block_timestamp }) => ({ price, block_timestamp })
          )
        : [];

      // 12 month historical data
      const twelveMonthHistoryRecords =
        processedSalesResults[1].status === 'fulfilled'
          ? Object.values(processedSalesResults[1].value).sort(
              (a, b) =>
                new Date(a.block_timestamp) - new Date(b.block_timestamp)
            )
          : [];
      // Only send Range, Units Sold, Average Price as the stats record
      const records = {
        originFluctuation: calculatePriceFluctuation(
          Object.values(twelveMonthHistoryRecords)
        ),
        originVolume: calculateVolumeTraded(
          Object.values(twelveMonthHistoryRecords)
        ),
        originAveragePrice: calculateAverageSalePrice(
          Object.values(twelveMonthHistoryRecords)
        ),
      };

      return { records, originRecords };
    } catch (error) {
      console.error('Error fetching price history:', error);
    }
  };

  // ------------------------------ ART STARTS ------------------------------

  contract.createArt = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    const newArgs = {
      ...args.itemArgs,
      createdDate,
      owner: rawAdmin.address,
      status: ASSET_STATUS.ACTIVE,
    };
    return artJs.uploadContract(rawAdmin, newArgs, options);
  };

  contract.getArts = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName };
    return artJs.getAll(rawAdmin, args, getOptions);
  };

  // ------------------------------ ART ENDS --------------------------------

  // ------------------------------ TOKENS STARTS ------------------------------

  contract.createTokens = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    const newArgs = {
      ...args.itemArgs,
      createdDate,
      status: ASSET_STATUS.ACTIVE,
    };
    return tokensJs.uploadContract(rawAdmin, newArgs, options);
  };

  contract.addHash = async function (args, options = defaultOptions) {
    return tokensJs.addHash(rawAdmin, args, options);
  };

  contract.getUSDSTBalance = async function (_, options = defaultOptions) {
    const USDSTOriginAddress = await tokensJs.getUSDSTAddress();
    const balance = await inventoryJs.getAll(
      rawAdmin,
      {
        ownerCommonName: userCert.commonName,
        originAddress: USDSTOriginAddress,
        queryOptions: { select: 'quantity.sum()' },
      },
      options
    );
    return balance[0].sum ? `${balance[0].sum / Math.pow(10, 18)}` : 0;
  };

  contract.getCataBalance = async function (_, options = defaultOptions) {
    const CataOriginAddress = await tokensJs.getCataAddress();
    const balance = await inventoryJs.getAll(
      rawAdmin,
      {
        ownerCommonName: userCert.commonName,
        originAddress: CataOriginAddress,
        queryOptions: { select: 'quantity.sum()' },
      },
      options
    );
    return balance[0].sum ? `${balance[0].sum / Math.pow(10, 18)}` : 0;
  };

  // ------------------------------ TOKENS ENDS --------------------------------

  // ------------------------------ CARBONOFFSET STARTS------------------------------

  contract.createCarbonOffset = async function (
    args,
    options = defaultOptions
  ) {
    const createdDate = Math.floor(Date.now() / 1000);
    const newArgs = {
      ...args.itemArgs,
      createdDate,
      status: ASSET_STATUS.ACTIVE,
    };
    return carbonOffsetJs.uploadContract(rawAdmin, newArgs, options);
  };

  contract.getCarbonOffsets = async function (
    args = {},
    options = optionsNoChainIds
  ) {
    const getOptions = { ...options, app: contractName };
    return carbonOffsetJs.getAll(rawAdmin, args, getOptions);
  };

  // ------------------------------ CARBONOFFSET ENDS--------------------------------

  // ------------------------------ METALS STARTS------------------------------

  contract.createMetals = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    const newArgs = {
      ...args.itemArgs,
      createdDate,
      owner: rawAdmin.address,
      status: ASSET_STATUS.ACTIVE,
    };
    return metalsJs.uploadContract(rawAdmin, newArgs, options);
  };

  contract.getMetals = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName };
    return metalsJs.getAll(rawAdmin, args, getOptions);
  };

  // ------------------------------ METALS ENDS--------------------------------

  // ------------------------------ SPIRITS STARTS------------------------------

  contract.createSpirits = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    const newArgs = {
      ...args.itemArgs,
      createdDate,
      owner: rawAdmin.address,
      status: ASSET_STATUS.ACTIVE,
    };
    return spiritsJs.uploadContract(rawAdmin, newArgs, options);
  };

  contract.getSpirits = async function (
    args = {},
    options = optionsNoChainIds
  ) {
    const getOptions = { ...options };
    return spiritsJs.getAll(rawAdmin, args, getOptions);
  };

  // ------------------------------ SPIRITS ENDS--------------------------------

  // ------------------------------ CLOTHING STARTS------------------------------

  contract.createClothing = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    const newArgs = {
      ...args.itemArgs,
      createdDate,
      status: ASSET_STATUS.ACTIVE,
    };
    return clothingJs.uploadContract(rawAdmin, newArgs, options);
  };

  contract.getClothings = async function (
    args = {},
    options = optionsNoChainIds
  ) {
    const getOptions = { ...options, app: contractName };
    return clothingJs.getAll(rawAdmin, args, getOptions);
  };

  // ------------------------------ CLOTHING ENDS--------------------------------

  // ------------------------------ MEMBERSHIP STARTS------------------------------

  contract.createMembership = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    const newArgs = {
      ...args.itemArgs,
      createdDate,
      owner: rawAdmin.address,
      status: ASSET_STATUS.ACTIVE,
    };
    return membershipJs.uploadContract(rawAdmin, newArgs, options);
  };

  contract.getMemberships = async function (
    args = {},
    options = optionsNoChainIds
  ) {
    const getOptions = { ...options, app: contractName };
    return membershipJs.getAll(rawAdmin, args, getOptions);
  };

  // ------------------------------ MEMBERSHIP ENDS--------------------------------

  // ------------------------------ CARBONDAO STARTS------------------------------

  contract.createCarbonDAO = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    const newArgs = {
      ...args.itemArgs,
      createdDate,
      status: ASSET_STATUS.ACTIVE,
    };
    return carbonDAOJs.uploadContract(rawAdmin, newArgs, options);
  };

  contract.getCarbonDAOs = async function (
    args = {},
    options = optionsNoChainIds
  ) {
    const getOptions = { ...options, app: contractName };
    return carbonDAOJs.getAll(rawAdmin, args, getOptions);
  };

  // ------------------------------ CARBONDAO ENDS--------------------------------

  // ------------------------------ COLLECTIBLES STARTS------------------------------

  contract.createCollectible = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    const newArgs = {
      ...args.itemArgs,
      createdDate,
      status: ASSET_STATUS.ACTIVE,
    };
    return collectibleJs.uploadContract(rawAdmin, newArgs, options);
  };

  contract.getCollectibles = async function (
    args = {},
    options = optionsNoChainIds
  ) {
    const getOptions = { ...options, app: contractName };
    return collectibleJs.getAll(rawAdmin, args, getOptions);
  };

  // ------------------------------ COLLECTIBLES ENDS--------------------------------

  // ------------------------------ SALE TEST STARTS ------------------------------

  contract.cancelSaleOrder = async function (args, options = defaultOptions) {
    const { paymentService, ...restArgs } = args;
    const contract = {
      name: saleOrderJs.paymentServiceContractName,
      address: paymentService.address,
    };
    return saleOrderJs.cancelOrder(rawAdmin, contract, restArgs, options);
  };

  contract.getSaleOrders = async function (args, options = defaultOptions) {
    const getOptions = { ...options, app: contractName };

    let { orders, total } = await saleOrderJs.getAll(
      rawAdmin,
      args,
      getOptions
    );
    let data;
    let saleAddressArr = [];
    data = orders?.map((item) => {
      if (item?.saleAddresses?.length) {
        saleAddressArr.push(item?.saleAddresses[0]);
        return { ...item, saleAddress: item?.saleAddresses[0] };
      } else if (item['BlockApps-Mercata-Order-saleAddresses']) {
        const address = item['BlockApps-Mercata-Order-saleAddresses'][0]?.value;
        saleAddressArr.push(address);
        return { ...item, saleAddress: address };
      } else {
        saleAddressArr.push(item?.saleAddresses);
        return { ...item, saleAddress: item?.saleAddresses };
      }
    });

    const sales = await saleJs.getAll(
      rawAdmin,
      { saleAddresses: saleAddressArr },
      options
    );

    let assets = [];
    for (const sale of sales) {
      const history = await saleJs.getSaleHistory(
        rawAdmin,
        {
          transaction_hash: sale.transaction_hash,
          assetToBeSold: sale.assetToBeSold,
        },
        options
      );
      const price = history['0'] ? history['0'].price : null;

      assets.push({
        assetAddress: sale.assetToBeSold,
        price: price,
        assetPrice: sale?.price,
        saleQuantity: sale.quantity,
        saleAddress: sale.address,
      });
    }

    data = data.map((item) => {
      const saleData = assets.find(
        (asset) => asset.saleAddress === item.saleAddress
      );
      return { ...item, ...saleData };
    });

    return { orderData: data, total };
  };

  contract.checkSaleQuantity = async function (args, options = defaultOptions) {
    const getOptions = { ...options, app: contractName };
    return inventoryJs.checkSaleQuantity(rawAdmin, args, getOptions);
  };

  contract.getOrder = async function (args, options = defaultOptions) {
    try {
      const order = await saleOrderJs.get(rawAdmin, args, options);

      // Extracting the sale addresses
      const saleAddresses = order.saleAddresses
        ? order.saleAddresses
        : order['BlockApps-Mercata-Order-saleAddresses'].map(
            (item) => item.value
          );
      const sales = await saleJs.getAll(
        rawAdmin,
        { saleAddresses: saleAddresses },
        options
      );
      let assets = [];

      for (const sale of sales) {
        const history = await saleJs.getSaleHistory(
          rawAdmin,
          {
            transaction_hash: order.transaction_hash,
            assetToBeSold: sale.assetToBeSold,
          },
          options
        );
        const price = history['0'] ? history['0'].price : null;

        const assetAddress = sale.assetToBeSold;
        const assetWithoutQuantity = await inventoryJs.get(
          rawAdmin,
          { address: assetAddress },
          options
        );

        assets.push({
          ...assetWithoutQuantity,
          price: price,
          saleQuantity: sale.quantity,
          saleAddress: sale.address,
          amount: sale.quantity * price,
        });
      }

      const result = {
        userContactAddress: order.shippingAddress,
        order,
        assets,
      };

      return result;
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(
          error.response.status,
          error.response.statusText
        );
      }
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Error while fetching the order'
      );
    }
  };

  contract.completeOrder = async function (args, options = defaultOptions) {
    return saleOrderJs.completeOrder(rawAdmin, args, options);
  };

  contract.updateOrderComment = async function (
    args,
    options = defaultOptions
  ) {
    const { saleOrderAddress, comments, ...restArgs } = args;
    const contract = {
      name: saleOrderJs.contractName,
      address: saleOrderAddress,
    };
    return saleOrderJs.updateOrderComment(
      rawAdmin,
      contract,
      options,
      comments
    );
  };

  contract.export = async function (options = defaultOptions) {
    const getOptions = { ...options, app: contractName };

    const processOrders = async (orderArg) => {
      const orders = await saleOrderJs.getAll(rawAdmin, orderArg, getOptions);
      if (orders.orders.length === 0) {
        return [];
      }
      let saleAddresses = [];

      orders.orders.forEach((order) => {
        if (
          order['BlockApps-Mercata-Order-saleAddresses'] &&
          Array.isArray(order['BlockApps-Mercata-Order-saleAddresses'])
        ) {
          order['BlockApps-Mercata-Order-saleAddresses'].forEach(
            (saleAddress) => {
              if (saleAddress.value) {
                saleAddresses.push(saleAddress.value);
              }
            }
          );
        }
        if (order.saleAddresses?.length) {
          saleAddresses.push(order.saleAddresses[0]);
        }
      });

      const sales = await saleJs.getAll(rawAdmin, { saleAddresses }, options);

      const uniqueAssetAddresses = [
        ...new Set(sales.map((sale) => sale.assetToBeSold)),
      ];
      const assets = await inventoryJs.getAll(
        rawAdmin,
        { assetAddresses: uniqueAssetAddresses },
        options
      );
      const assetLookup = new Map(
        assets.map((asset) => [asset.address, asset])
      );

      for (const order of orders.orders) {
        const assetsPromises = saleAddresses.map(async (saleAddress) => {
          const sale = sales.find((sale) => sale.address === saleAddress);
          if (!sale) return undefined;

          const history = await saleJs.getSaleHistory(
            rawAdmin,
            {
              transaction_hash: order.transaction_hash,
              assetToBeSold: sale.assetToBeSold,
            },
            options
          );

          const asset = assetLookup.get(sale.assetToBeSold);
          return asset
            ? { ...asset, salePrice: history['0']?.price || 0 }
            : undefined;
        });

        order.assets = (await Promise.all(assetsPromises)).filter(
          (asset) => asset !== undefined
        );
      }

      return orders.orders;
    };

    const getItemTransferEventsWithAssetInfo = async (orderArg) => {
      const itemTransferEvents = await inventoryJs.getAllItemTransferEvents(
        rawAdmin,
        orderArg,
        getOptions
      );
      if (itemTransferEvents.transfers.length === 0) {
        return [];
      }
      const assetAddresses = itemTransferEvents.transfers.map(
        (event) => event.assetAddress
      );
      const uniqueAssetAddresses = [...new Set(assetAddresses)];
      const assets = await inventoryJs.getAll(
        rawAdmin,
        { assetAddresses: uniqueAssetAddresses },
        getOptions
      );

      const assetInfoMap = new Map(
        assets.map((asset) => [
          asset.address,
          { contract_name: asset.contract_name },
        ])
      );
      return itemTransferEvents.transfers.map((event) => {
        return {
          ...event,
          contract_name: assetInfoMap.get(event.assetAddress)?.contract_name,
        };
      });
    };

    let soldOrderArgs = {
      limit: 2000,
      offset: 0,
      order: 'createdDate.desc',
      sellersCommonName: userCommonName,
    };
    const soldOrders = await processOrders(soldOrderArgs);

    let boughtOrderArgs = {
      limit: 2000,
      offset: 0,
      order: 'createdDate.desc',
      purchasersCommonName: userCommonName,
    };
    const boughtOrders = await processOrders(boughtOrderArgs);

    let transferArgs = {
      limit: 2000,
      offset: 0,
      order: 'transferDate.desc',
      or: `(oldOwnerCommonName.eq.${userCommonName},newOwnerCommonName.eq.${userCommonName})`,
    };
    const itemTransferEvents = await getItemTransferEventsWithAssetInfo(
      transferArgs
    );

    return {
      soldOrders: soldOrders ? soldOrders : [],
      boughtOrders: boughtOrders ? boughtOrders : [],
      transfers: itemTransferEvents ? itemTransferEvents : [],
    };
  };

  // ------------------------------ SALE TEST ENDS ------------------------------

  /* ------------------------ User Activity Starts ------------------------ */
  contract.getAllUserActivity = async function (
    args,
    options = defaultOptions
  ) {
    const getOptions = { ...options, app: contractName };
    const { sellersCommonName, purchasersCommonName, newOwnerCommonName } =
      args;

    const currentDate = dayjs(); // Get the current date with dayjs
    const tenDaysAgoDate = currentDate.subtract(10, 'day'); // Subtract 10 days
    const tenDaysAgoTimestamp =
      tenDaysAgoDate.utc().format('YYYY-MM-DD HH:mm:ss') + ' UTC'; // Format the date

    // Need to fetch purchases, closed orders, transfers for the user.
    // New Purchases of User's Products---Fetch Orders with filters of sellersCommonName, block_timestamp and Order Status = AWAITING_FULFILLMENT (1)
    const purchaseArgs = {
      sellersCommonName,
      status: 1,
      gtField: 'block_timestamp',
      gtValue: tenDaysAgoTimestamp,
    };
    const purchases = await saleOrderJs.getAll(
      rawAdmin,
      purchaseArgs,
      getOptions
    );

    // These are my orders that ave been closed by a seller
    const orderArgs = {
      purchasersCommonName,
      status: 3,
      gtField: 'block_timestamp',
      gtValue: tenDaysAgoTimestamp,
    };
    const orders = await saleOrderJs.getAll(rawAdmin, orderArgs, getOptions);

    // These are transfers the usre has recieved
    const transferArgs = {
      newOwnerCommonName,
      gtField: 'block_timestamp',
      gtValue: tenDaysAgoTimestamp,
    };
    const transfers = await inventoryJs.getAllItemTransferEvents(
      rawAdmin,
      transferArgs,
      getOptions
    );

    // Fetch activities and add type to each item
    const purchasesWithTypes = purchases.orders.map((p) => ({
      ...p,
      type: 'sold',
    }));
    const ordersWithTypes = orders.orders.map((o) => ({
      ...o,
      type: 'bought',
    }));
    const transfersWithTypes = transfers.transfers.map((t) => ({
      ...t,
      type: 'transfer',
    }));

    // Combine all activities into one array
    const allActivities = [
      ...purchasesWithTypes,
      ...ordersWithTypes,
      ...transfersWithTypes,
    ];
    // Sort by block_timestamp
    allActivities.sort(
      (a, b) => new Date(b.block_timestamp) - new Date(a.block_timestamp)
    );

    return allActivities;
  };

  /* ------------------------ User Activity Ends------------------------ */

  // //-----------------------------PAYMENT starts here -------------------------------

  contract.getPaymentServices = async function (
    args,
    options = defaultOptions
  ) {
    const paymentServices = await paymentServiceJs.getAll(
      rawAdmin,
      args,
      options
    );
    return paymentServices;
  };

  contract.getNotOnboardedPaymentServices = async function (
    args,
    options = defaultOptions
  ) {
    const paymentServices = await paymentServiceJs.getNotOnboarded(
      rawAdmin,
      args,
      options
    );
    return paymentServices;
  };

  contract.paymentCheckout = async function (args, options = defaultOptions) {
    try {
      const { paymentService, orderList } = args;

      const assetAddresses = orderList.map((o) => o.assetAddress);
      const quantities = orderList.map((o) => o.quantity);

      const assets = await inventoryJs.getAll(
        rawAdmin,
        { assetAddresses: assetAddresses },
        options
      );

      const saleAddresses = assets.map((a) => a.saleAddress);

      if (assets.length == 0 || assets.length != orderList.length) {
        throw new rest.RestError(RestStatus.NOT_FOUND, 'Inventory not found');
      }

      const sellerName = assets[0].ownerCommonName;
      for (const currInventory of assets) {
        if (currInventory.ownerCommonName == userCert.commonName) {
          throw new rest.RestError(
            RestStatus.BAD_REQUEST,
            'Seller cannot buy his own product'
          );
        }

        /* User shouldn't be allowed buy products from multiple sellers  */
        if (sellerName != currInventory.ownerCommonName) {
          throw new rest.RestError(
            RestStatus.BAD_REQUEST,
            'Cannot buy products from multiple sellers in the same Order/Checkout'
          );
        }
      }

      let USDSTAssetAddressesToUse = [];
      if (paymentService.serviceName.toLowerCase().includes('usdst')) {
        // Get User's USDST Asset Address
        const USDSTOriginAddress = await tokensJs.getUSDSTAddress();

        // Retrieve all sales data
        const salesData = await saleJs.getAll(
          rawAdmin,
          { saleAddresses },
          options
        );

        // Calculate the total order amount
        const orderTotal = salesData.reduce(
          (acc, sale, index) => acc + sale.price * quantities[index],
          0
        );

        // Retrieve the user's active USDST asset addresses with non-zero quantities
        const userUSDSTAssets = await inventoryJs.getAll(
          rawAdmin,
          {
            ownerCommonName: userCert.commonName,
            originAddress: USDSTOriginAddress,
            status: ASSET_STATUS.ACTIVE,
            queryOptions: { select: 'address, quantity' },
            notEqualsField: 'quantity',
            notEqualsValue: '0',
            order: 'quantity.desc',
          },
          options
        );

        // Accumulate USDST asset addresses to cover the order total
        let accumulatedTotal = new BigNumber(0);
        const bigOrderTotal = new BigNumber(orderTotal).multipliedBy(
          new BigNumber(10).pow(18)
        ); // Convert orderTotal to 18 decimal places

        USDSTAssetAddressesToUse = userUSDSTAssets.reduce(
          (addresses, asset) => {
            if (accumulatedTotal.gte(bigOrderTotal)) return addresses;

            addresses.push(asset.address);

            // Convert asset.quantity to BigNumber, then add to accumulatedTotal
            accumulatedTotal = accumulatedTotal.plus(new BigNumber(asset.quantity));

            return addresses;
          },
          []
        );

        if (accumulatedTotal.isLessThan(bigOrderTotal)) {
          throw new rest.RestError(
            RestStatus.BAD_REQUEST,
            "You don't have enough USDST balance to make this purchase"
          );
        }
      }

      const createdDate = Math.floor(Date.now() / 1000);
      const paymentParameters = {
        address: paymentService.address,
        tokenAssetAddresses: USDSTAssetAddressesToUse,
        checkoutId: util.uid(),
        saleAddresses,
        quantities,
        createdDate,
        comments: DEFAULT_COMMENT,
      };
      const checkoutHashAndAssets = await paymentServiceJs.createPayment(
        rawAdmin,
        paymentParameters,
        options
      );

      return checkoutHashAndAssets;
    } catch (error) {
      console.log(error);
      if (error.response) {
        throw new rest.RestError(
          error.response.status,
          error.response.statusText
        );
      }
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        'Error while updating the order'
      );
    }
  };

  contract.getUSDSTOrderEvent = async function (
    args,
    options = defaultOptions
  ) {
    const currentPaymentService = await paymentServiceJs.getAll(
      rawAdmin,
      { address: args.paymentService },
      options
    );
    if (
      currentPaymentService[0].contract_name.includes('TokenPaymentService')
    ) {
      const orderEvent = await rest.searchUntil(
        rawAdmin,
        { name: 'BlockApps-Mercata-PaymentService.Order' },
        (r) => r.length === 1,
        {
          ...options,
          query: {
            limit: 1,
            orderHash: `eq.${args.orderHash}`,
            currency: 'eq.USDST',
          },
        }
      );
      return orderEvent;
    }
  };

  contract.waitForOrderEvent = async function (args, options = defaultOptions) {
    const orderEvent = await rest.searchUntil(
      rawAdmin,
      { name: 'BlockApps-Mercata-PaymentService.Order' },
      (r) => r.length === 1,
      {
        ...options,
        query: {
          limit: 1,
          orderHash: `eq.${args.orderHash}`,
        },
      }
    );
    return orderEvent;
  };

  contract.createUserAddress = async function (args, options = defaultOptions) {
    const { redemptionService, ...restArgs } = args;
    try {
      const { serviceURL, createCustomerAddressRoute = '' } =
        await redemptionServiceJs.get(
          rawAdmin,
          { address: redemptionService },
          options
        );
      await axios
        .post(new URL(createCustomerAddressRoute, serviceURL).href, {
          commonName: userCert.commonName,
          ...restArgs,
        })
        .then(function (res) {
          if (res.status === 200) {
            // Success case
          } else {
            throw new rest.RestError(
              RestStatus.BAD_REQUEST,
              `Payment server call failed: ${res.statusText}`
            );
          }
        });
      return {};
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(
          error.response.status,
          error.response.statusText
        );
      }
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        `Error while adding address: ${JSON.stringify(error)} `
      );
    }
  };

  contract.getUserAddress = async function (args, options = optionsNoChainIds) {
    const { redemptionService, shippingAddressId } = args;
    try {
      const { serviceURL, getCustomerAddressRoute = '' } =
        await redemptionServiceJs.get(
          rawAdmin,
          { address: redemptionService },
          options
        );
      const userAddress = await axios
        .get(
          new URL(
            `${getCustomerAddressRoute}/id/${shippingAddressId}`,
            serviceURL
          ).href
        )
        .then(function (res) {
          if (res.status === 200) {
            return res.data.data;
          } else {
            throw new rest.RestError(
              RestStatus.BAD_REQUEST,
              `Payment server call failed: ${res.statusText}`
            );
          }
        });
      return userAddress;
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(
          error.response.status,
          error.response.statusText
        );
      }
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        `Error while fetching shipping address: ${JSON.stringify(error)} `
      );
    }
  };

  contract.getAllUserAddress = async function (
    args,
    options = optionsNoChainIds
  ) {
    const { redemptionService } = args;
    try {
      const { serviceURL, getCustomerAddressRoute = '' } =
        await redemptionServiceJs.get(
          rawAdmin,
          { address: redemptionService },
          options
        );
      const userAddresses = await axios
        .get(
          new URL(
            `${getCustomerAddressRoute}/${userCert.commonName}`,
            serviceURL
          ).href
        )
        .then(function (res) {
          if (res.status === 200) {
            return res.data.data;
          } else {
            throw new rest.RestError(
              RestStatus.BAD_REQUEST,
              `Payment server call failed: ${res.statusText}`
            );
          }
        });
      return userAddresses;
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(
          error.response.status,
          error.response.statusText
        );
      }
      throw new rest.RestError(
        RestStatus.BAD_REQUEST,
        `Error while fetching shipping addresses: ${JSON.stringify(error)} `
      );
    }
  };

  //----------------------------- Reserve START -------------------------------
  contract.getReserve = async function (address, options = defaultOptions) {
    return await reserveJs.get(rawAdmin, address, options);
  };

  contract.getAllReserve = async function (options = defaultOptions) {
    return await reserveJs.getAll(rawAdmin, options);
  };

  contract.getEscrowForAsset = async function (args, options = defaultOptions) {
    const { assetRootAddress } = args;
    const queryArgs = {
      select: '*,BlockApps-Mercata-Escrow-assets(*)',
      assetRootAddress: `like.${assetRootAddress}*`,
      borrowerCommonName: `eq.${userCommonName}`,
      isActive: 'eq.true',
    };
    return await escrowJs.searchEscrow(rawAdmin, queryArgs, options);
  };

  contract.userCataRewards = async function (options = defaultOptions) {
    return await escrowJs.userCataRewards(
      rawAdmin,
      userCert.commonName,
      options
    );
  };

  contract.oraclePrice = async function (args, options = defaultOptions) {
    return await reserveJs.oraclePrice(rawAdmin, args, options);
  };

  contract.stake = async function (args, options = defaultOptions) {
    return await reserveJs.stake(rawAdmin, args, options);
  };

  contract.unstake = async function (args, options = defaultOptions) {
    return await reserveJs.unstake(rawAdmin, args, options);
  };

  contract.borrow = async function (args, options = defaultOptions) {
    return await reserveJs.borrow(rawAdmin, args, options);
  };

  contract.repay = async function (args, options = defaultOptions) {
    const { escrow, reserve } = args;

    // Fetch user's USDST asset origin address
    const USDSTOriginAddress = await tokensJs.getUSDSTAddress();

    // Retrieve escrow data associated with the escrow address
    const escrowData = await escrowJs.get(rawAdmin, escrow, options);
    const orderTotal = escrowData ? escrowData.borrowedAmount : 0;
    if (orderTotal === 0) {
      return;
    }

    // Get user's active USDST assets with non-zero quantities
    const userUSDSTAssets = await inventoryJs.getAll(
      rawAdmin,
      {
        ownerCommonName: userCert.commonName,
        originAddress: USDSTOriginAddress,
        status: ASSET_STATUS.ACTIVE,
        queryOptions: { select: 'address, quantity' },
        notEqualsField: 'quantity',
        notEqualsValue: '0',
        order: 'block_timestamp.desc',
      },
      options
    );

    // Accumulate USDST asset addresses to cover the order total
    const { addressesToUse } = userUSDSTAssets.reduce(
      (acc, asset) => {
        if (
          acc.accumulatedTotal.isGreaterThanOrEqualTo(
            new BigNumber(orderTotal).multipliedBy(new BigNumber(10).pow(18))
          )
        ) {
          return acc;
        }

        acc.addressesToUse.push(asset.address);
        acc.accumulatedTotal = acc.accumulatedTotal.plus(
          new BigNumber(asset.quantity)
        );

        return acc;
      },
      { addressesToUse: [], accumulatedTotal: new BigNumber(0) }
    ) //.addressesToUse; //Remove this...

    // Proceed with unstake if sufficient assets are accumulated
    return await reserveJs.repay(
      rawAdmin,
      { USDSTAssetAddresses: addressesToUse, escrowAddress: escrow, reserve },
      options
    );
  };

  contract.getStakeTransactions = async function (
    args,
    options = defaultOptions
  ) {
    const { userAddress, ...restArgs } = args;

    const stakeCreatedEvents = await reserveJs.getStakeCreatedEvents(
      rawAdmin,
      { user: userAddress || '' },
      options
    );

    const stakeCreatedEventAddresses =
      stakeCreatedEvents.stakeCreatedEvents.map((event) => event.escrow);

    const escrows = await escrowJs.getEscrowsForStakeTransactions(
      rawAdmin,
      { ...restArgs, address: stakeCreatedEventAddresses },
      options
    );

    const stakeTransactions = stakeCreatedEvents.stakeCreatedEvents
      .map((record) => {
        const escrow = escrows.escrows.find(
          (escrow) => escrow.address === record.escrow
        );

        if (!escrow) {
          return;
        }

        const date = new Date(record.block_timestamp);
        const unixTimestamp = Math.floor(date.getTime() / 1000);

        return {
          ...escrow,
          assetAddress: escrow.assetRootAddress.split(':')[0],
          type: 'Stake',
          stakeId: record.id,
          createdDate: unixTimestamp,
          quantity: record.assetAmount,
          transaction_hash: record.transaction_hash,
          price: null,
        };
      })
      .filter(Boolean);

    return {
      stakeTransactions: stakeTransactions,
      total: stakeTransactions.length,
    };
  };

  contract.getUnstakeTransactions = async function (
    args,
    options = defaultOptions
  ) {
    const { userAddress, ...restArgs } = args;

    const unstakeEvents = await reserveJs.getUnstakeEvents(
      rawAdmin,
      { user: userAddress || '' },
      options
    );

    const unstakeEventAddresses = unstakeEvents.unstakeEvents.map(
      (event) => event.escrow
    );

    const escrows = await escrowJs.getEscrowsForStakeTransactions(
      rawAdmin,
      { ...restArgs, address: unstakeEventAddresses },
      options
    );

    const unstakeTransactions = unstakeEvents.unstakeEvents
      .map((record) => {
        const escrow = escrows.escrows.find(
          (escrow) => escrow.address === record.escrow
        );

        if (!escrow) {
          return;
        }

        const date = new Date(record.block_timestamp);
        const unixTimestamp = Math.floor(date.getTime() / 1000);

        return {
          ...escrow,
          assetAddress: escrow.assetRootAddress.split(':')[0],
          type: 'Unstake',
          stakeId: record.id,
          createdDate: unixTimestamp,
          quantity: record.quantity,
          transaction_hash: record.transaction_hash,
          price: null,
        };
      })
      .filter(Boolean);

    return {
      unstakeTransactions: unstakeTransactions,
      total: unstakeTransactions.length,
    };
  };
  // ---------------------------- Reserve END   -------------------------------
  return contract;
}

/**
 * Add a new organization to a tCommerce contract/chain.
 * @param {string} orgName The new organization to add
 */
async function addOrg(user, contract, options, orgName) {
  const callArgs = { contract, method: 'addOrg', args: util.usc({ orgName }) };
  return rest.call(user, callArgs, options);
}

/**
 * Add a new organization unit to a tCommerce contract/chain.
 * @param {string} orgName The organization the unit to add belongs to
 * @param {string} orgUnit The new organization unit to add
 */
async function addOrgUnit(user, contract, options, orgName, orgUnit) {
  const callArgs = {
    contract,
    method: 'addOrgUnit',
    args: util.usc({ orgName, orgUnit }),
  };
  return rest.call(user, callArgs, options);
}

/**
 * Add a new member to a tCommerce contract/chain.
 * @param {string} orgName The organization the member to add belongs to
 * @param {string} orgUnit The organization unit the member to add belongs to
 * @param {string} commonName The common name of the member to add
 */
async function addMember(
  user,
  contract,
  options,
  orgName,
  orgUnit,
  commonName
) {
  const callArgs = {
    contract,
    method: 'addMember',
    args: util.usc({ orgName, orgUnit, commonName }),
  };
  return rest.call(user, callArgs, options);
}

/**
 * Remove an existing organization from a tCommerce contract/chain.
 * @param {string} orgName The organization to remove
 */
async function removeOrg(user, contract, options, orgName) {
  const callArgs = {
    contract,
    method: 'removeOrg',
    args: util.usc({ orgName }),
  };
  return rest.call(user, callArgs, options);
}

/**
 * Remove an existing organization unit from a tCommerce contract/chain.
 * @param {string} orgName The organization the unit to remove belongs to
 * @param {string} orgUnit The organization unit to remove
 */
async function removeOrgUnit(user, contract, options, orgName, orgUnit) {
  const callArgs = {
    contract,
    method: 'removeOrgUnit',
    args: util.usc({ orgName, orgUnit }),
  };
  return rest.call(user, callArgs, options);
}

/**
 * Remove an existing member from a tCommerce contract/chain.
 * @param {string} orgName The organization the member to remove belongs to
 * @param {string} orgUnit The organization unit the member to remove belongs to
 * @param {string} commonName The common name of the member to remove
 */
async function removeMember(
  user,
  contract,
  options,
  orgName,
  orgUnit,
  commonName
) {
  const callArgs = {
    contract,
    method: 'removeMember',
    args: util.usc({ orgName, orgUnit, commonName }),
  };
  return rest.call(user, callArgs, options);
}

/**
 * Add multiple new organizations to a tCommerce contract/chain.
 * @param {string} orgNames An array of new organizations to add
 */
async function addOrgs(user, contract, options, orgNames) {
  const callArgs = {
    contract,
    method: 'addOrgs',
    args: util.usc({ orgNames }),
  };
  return rest.call(user, callArgs, options);
}

/**
 * Add multiple new organization units to a tCommerce contract/chain.
 * @param {string} orgNames An array of organizations the units to add belongs to
 * @param {string} orgUnits An array of new organization units to add
 */
async function addOrgUnits(user, contract, options, orgNames, orgUnits) {
  const callArgs = {
    contract,
    method: 'addOrgUnits',
    args: util.usc({ orgNames, orgUnits }),
  };
  return rest.call(user, callArgs, options);
}

/**
 * Add multiple new members to a tCommerce contract/chain.
 * @param {string} orgNames An array of organizations the units to add belongs to
 * @param {string} orgUnits An array of organization units the members to add belongs to
 * @param {string} commonNames An array of the common names of the members to add
 */
async function addMembers(
  user,
  contract,
  options,
  orgNames,
  orgUnits,
  commonNames
) {
  const callArgs = {
    contract,
    method: 'addMembers',
    args: util.usc({ orgNames, orgUnits, commonNames }),
  };
  return rest.call(user, callArgs, options);
}

/**
 * Remove multiple existing organizations from a tCommerce contract/chain.
 * @param {string} orgNames An array of organizations to remove
 */
async function removeOrgs(user, contract, options, orgNames) {
  const callArgs = {
    contract,
    method: 'removeOrgs',
    args: util.usc({ orgNames }),
  };
  return rest.call(user, callArgs, options);
}

/**
 * Remove multiple existing organization units from a tCommerce contract/chain.
 * @param {string} orgNames An array of organizations the units to remove belongs to
 * @param {string} orgUnits An array of organization units to remove
 */
async function removeOrgUnits(user, contract, options, orgNames, orgUnits) {
  const callArgs = {
    contract,
    method: 'removeOrgUnits',
    args: util.usc({ orgNames, orgUnits }),
  };
  return rest.call(user, callArgs, options);
}

/**
 * Remove multiple existing members from a tCommerce contract/chain.
 * @param {string} orgNames An array of organizations the units to remove belongs to
 * @param {string} orgUnits An array of organization units the members to remove belongs to
 * @param {string} commonNames An array of the common names of the members to remove
 */
async function removeMembers(
  user,
  contract,
  options,
  orgNames,
  orgUnits,
  commonNames
) {
  const callArgs = {
    contract,
    method: 'removeMembers',
    args: util.usc({ orgNames, orgUnits, commonNames }),
  };
  return rest.call(user, callArgs, options);
}

async function getChainById(user, chainId) {
  const chainInfo = await rest.getChain(user, chainId, options);
  return chainInfo;
}

async function getChains(user, chainIds = []) {
  const keyResponse = await rest.getKey(user, defaultOptions);
  let chains;

  try {
    chains = await rest.getChains(user, chainIds, defaultOptions);
  } catch (e) {
    if (e.response.status === 500) {
      chains = [];
    }
    console.error('Error getting chainInfo:', e);
  }

  const filtered = chains.reduce((acc, c) => {
    const member = c.info.members.find((m) => {
      return m.address === keyResponse;
    });
    if (member !== undefined) {
      acc.push(c);
    }
    return acc;
  }, []);

  return filtered;
}

function bindAddress(user, address, options) {
  const contract = {
    name: contractName,
    address,
  };
  return bind(user, contract, options);
}

export default {
  bind,
  loadFromDeployment,
  uploadContract,
  bindAddress,
  contractName,
  uploadDappContract,
};
