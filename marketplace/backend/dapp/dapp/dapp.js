import { rest, util, importer } from "blockapps-rest";
const { createContract } = rest;
import constants, { 
  STRIPE_PAYMENT_SERVER_URL, 
  calculatePriceFluctuation, 
  calculateAveragePrice, 
  calculateVolumeTraded, 
  getOneYearAgoTime, 
  getSixMonthsAgoTime, 
  getDate,
  timeFilterForAll, 
  timeFilterForOneYear, 
  timeFilterForSixMonths 
} from "/helpers/constants";
import { yamlWrite, yamlSafeDumpSync, getYamlFile } from "/helpers/config";
import { pollingHelper } from "/helpers/utils";

import axios from 'axios';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import RestStatus from 'http-status-codes';
import certificateJs from "/dapp/certificates/certificate";

import artJs from "/dapp/items/art";
import carbonOffsetJs from "/dapp/items/carbonOffset";
import metalsJs from "/dapp/items/metals";
import clothingJs from "/dapp/items/clothing";
import membershipJs from "/dapp/items/membership";
import carbonDAOJs from "/dapp/items/carbonDAO";
import collectibleJs from "dapp/items/collectibles";

import saleJs from "/dapp/orders/sale";
import saleOrderJs from "/dapp/orders/saleOrder";

import inventoryJs from "/dapp/products/inventory";
import marketplaceJs from "/dapp/marketplace/marketplace.js";
import paymentProviderJs from '/dapp/payments/paymentProvider';

import strats from "../strats/strats";

const allAssetNames = [];
dayjs.extend(utc);
const contractName = "Mercata";
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
  console.log(options)
  // author the deployment
  const { deployFilePath } = args;

  const deployment = {
    url: options.config.nodes[0].url,
    dapp: {
      contract: {
        name: contract.name,
        address: contract.address
      },
    }
  };

  if (options.config.apiDebug) {
    console.log("deploy filename:", deployFilePath);
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
  contract.src = "removed";

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
  contract.src = "removed";

  return await bind(token, contract, options);
}

async function bind(rawAdmin, _contract, _defaultOptions, serviceUser = false) {
  const contract = _contract;
  console.debug(contract)
  let userOrganization
  let userCommonName

  if (!serviceUser) {

    let userCertificate = await pollingHelper(certificateJs.getCertificateMe, [rawAdmin]);

    //We are not guaranteed the user will have a certificate
    //99% chance they do, but if this this their first login
    //the node might not have a certificate in time
    if (!(userCertificate === null || userCertificate === undefined || userCertificate.commonName === null || userCertificate.commonName === undefined)) {
      contract.userOrganization = userCertificate.organization
      userOrganization = userCertificate.organization
      userCommonName = userCertificate.commonName
      userCert = userCertificate;//Attaching user cert to dapp to save from needing make another call to get it
    }
  }

  // includes the org+app for cirrus namespacing (helpers/utils.js will prepend to cirrus queries)
  const defaultOptions = { ..._defaultOptions, app: contractName, chainIds: [], };
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
    return addMember(admin, contract, defaultOptions, orgName, orgUnit, commonName);
  };
  contract.removeOrg = async function (orgName) {
    return removeOrg(admin, contract, defaultOptions, orgName);
  };
  contract.removeOrgUnit = async function (orgName, orgUnit) {
    return removeOrgUnit(admin, contract, defaultOptions, orgName, orgUnit);
  };
  contract.removeMember = async function (orgName, orgUnit, commonName) {
    return removeMember(admin, contract, defaultOptions, orgName, orgUnit, commonName);
  };

  // governance - multiple adds
  contract.addOrgs = async function (orgNames) {
    return addOrgs(admin, contract, defaultOptions, orgNames);
  };
  contract.addOrgUnits = async function (orgNames, orgUnits) {
    return addOrgUnits(admin, contract, defaultOptions, orgNames, orgUnits);
  };
  contract.addMembers = async function (orgNames, orgUnits, commonNames) {
    return addMembers(admin, contract, defaultOptions, orgNames, orgUnits, commonNames);
  };
  contract.removeOrgs = async function (orgNames) {
    return removeOrgs(admin, contract, defaultOptions, orgNames);
  };
  contract.removeOrgUnits = async function (orgNames, orgUnits) {
    return removeOrgUnits(admin, contract, defaultOptions, orgNames, orgUnits);
  };
  contract.removeMembers = async function (orgNames, orgUnits, commonNames) {
    return removeMembers(admin, contract, defaultOptions, orgNames, orgUnits, commonNames);
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
  contract.getCertificateMe = (!(userCert === null || userCert === undefined)) ? userCert : async function () {
    return certificateJs.getCertificateMe(admin);
  };
  contract.getCertificates = async function (args) {
    return certificateJs.getCertificates(admin, args);
  };

  // -------------------------- INVENTORY --------------------------------

  contract.getInventory = async function (args, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName, };
    return await inventoryJs.get(rawAdmin, { ...args }, getOptions);
  };

  contract.getInventories = async function (args, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName };
    const inventories = await inventoryJs.getAll(rawAdmin, { ...args, ownerCommonName: userCert.commonName, sort: '-createdDate' }, getOptions);
    const inventoryCount = await inventoryJs.inventoryCount(rawAdmin, { ...args, ownerCommonName: userCert.commonName, sort: '-createdDate' }, getOptions);
    return { inventories: inventories, inventoryCount: inventoryCount }
  };

  contract.getInventoriesForUser = async function (args, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName };
    const {ownerCommonName, ...restArgs} = args;
    const newArgs = { ...restArgs, ownerCommonName:ownerCommonName, notEqualsField: 'sale', notEqualsValue: constants.zeroAddress, userProfile:true }//'0000000000000000000000000000000000000000'
    return marketplaceJs.getAll(rawAdmin, newArgs, getOptions);
  };

  contract.getOwnershipHistory = async function (args, options = optionsNoChainIds) {
    console.log('#### GET OWNERSHIP HISTORY ARGS', JSON.stringify(args))
    return await inventoryJs.getOwnershipHistory(rawAdmin, args, options);
  };

  contract.listItem = async function (args, options = defaultOptions) {
    return await inventoryJs.uploadSaleContract(rawAdmin, args, options);
  }

  contract.unlistItem = async function (args, options = defaultOptions) {
    const { saleAddress, ...restArgs } = args;
    const contract = { address: saleAddress };
    return await inventoryJs.unlistItem(rawAdmin, contract, restArgs, options);
  }

  contract.resellItem = async function (args, options = defaultOptions) {
    const { assetAddress, ...restArgs } = args;
    const contract = { address: assetAddress };
    return await inventoryJs.resellItem(rawAdmin, contract, restArgs, options);
  }

  contract.transferItem = async function (args, options = defaultOptions) {
    const { assetAddress, ...restArgs } = args;
    const transferNumber = parseInt(util.uid())
    const finalArgs = { transferNumber: transferNumber, ...restArgs };
    const contract = { address: assetAddress };
    return inventoryJs.transferItem(rawAdmin, contract, finalArgs, options);
  }

  contract.getAllItemTransferEvents = function (args, options = defaultOptions) {
    const getOptions = { ...options, app: contractName, };
    return inventoryJs.getAllItemTransferEvents(rawAdmin, args, getOptions);
  };

  contract.updateSale = async function (args, options = defaultOptions) {
    const { saleAddress, ...restArgs } = args;
    const contract = { address: saleAddress };
    return await inventoryJs.updateSale(rawAdmin, contract, restArgs, options);
  }

  contract.updateInventory = async function (args, options = defaultOptions) {
    const { itemContract, itemAddress, ...restArgs } = args;
    const contract = { name: itemContract, address: itemAddress };
    return await inventoryJs.updateInventory(rawAdmin, contract, restArgs, options);
  }

  // ------------------------------ INVENTORY ENDS--------------------------------

  contract.getMarketplaceInventories = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName };
    //for ba sellers, get all assets - display For Sale and Sold Out
    const newArgs = { ...args, ownerCommonName: constants.baUserNames }
    const all =  await marketplaceJs.getAll(rawAdmin, newArgs, getOptions);

    // for non-ba sellers, get assets with valid sale & saleQty > 0 - display only For Sale records
    const newArgs1 = { ...args, notEqualsField: ['ownerCommonName', 'sale'], notEqualsValue: [constants.baUserNames, constants.zeroAddress] }
    const all2 =  await marketplaceJs.getAll(rawAdmin, newArgs1, getOptions);
        
    return {inventoryResults: all.inventoryResults.concat(all2.inventoryResults), inventoryCount: all.inventoryCount + all2.inventoryCount};
  };

  contract.getMarketplaceInventoriesLoggedIn = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName };
    let usersArr = constants.baUserNames.filter(user => user !== userCommonName)
    const newArgs = { ...args, ownerCommonName: usersArr }
    const all = await marketplaceJs.getAll(rawAdmin, newArgs, getOptions);

    const newArgs1 = { ...args, notEqualsField: ['ownerCommonName', 'sale'], notEqualsValue: [[userCommonName, ...constants.baUserNames], constants.zeroAddress] }
    const all2 = await marketplaceJs.getAll(rawAdmin, newArgs1, getOptions);
    return {inventoryResults: all.inventoryResults.concat(all2.inventoryResults), inventoryCount: all.inventoryCount + all2.inventoryCount};
  };

  contract.getTopSellingProducts = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName }
    const newArgs = { ...args, notEqualsField: 'sale', notEqualsValue: constants.zeroAddress, ownerCommonName: constants.baUserNames }
    return marketplaceJs.getTopSellingProducts(rawAdmin, newArgs, getOptions)
  }

  contract.getTopSellingProductsLoggedIn = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName }
    const newArgs = {
      ...args, notEqualsField: ['sale', 'ownerCommonName'],
      notEqualsValue: [constants.zeroAddress, userCommonName] , ownerCommonName: constants.baUserNames
    }
    return marketplaceJs.getTopSellingProducts(rawAdmin, newArgs, getOptions)
  }

  contract.getPriceHistory = async function(args, options = defaultOptions) {
    try {
      const { assetAddress, timeFilter } = args;
  
      const assetWithoutQuantity = await inventoryJs.get(rawAdmin, { address: assetAddress }, options);
      const originAddress = assetWithoutQuantity.originAddress;

      // Fetch sales (12 months) for stats
      const originSalesForStats = await saleJs.getAll(rawAdmin, {
        assetToBeSold: originAddress,
        order: "block_timestamp.asc",
        gtField: "block_timestamp",
        gtValue: getOneYearAgoTime()
      }, options);
      console.log("Fetched origin yearly sales:", originSalesForStats.length, "sales");
  
      let salesFilter = { assetToBeSold: originAddress, order: "block_timestamp.asc" };
  
      // Sales Filter modification based on timeFilter
      if (timeFilter === timeFilterForSixMonths()) { 
        // Applying 6-month filter
        salesFilter.gtField = "block_timestamp";
        salesFilter.gtValue = getSixMonthsAgoTime();
      } else if (timeFilter === timeFilterForOneYear()) { 
        //Applying 1-year filter
        salesFilter.gtField = "block_timestamp";
        salesFilter.gtValue = getOneYearAgoTime();
      } else if (timeFilter === timeFilterForAll()) {
        // For 'All', no changes to salesFilter required
      } else {
        console.log('Invalid timeFilter');
        return;
      }
      // Fetch sales based on filter
      const originTimeRangeSales = await saleJs.getAll(rawAdmin, {
        ...salesFilter
      }, options);
  

  
      // Process records such that for a given date the most recent sale price is fetched
      // This method processes sales passed, drills down into history table for each sale
      // This needs to be done as a 2 step process, i.e. a single query to fetch sale & saleHistory can't be done because the contract name is dependent on the sale
      const processSalesHistory = async (sales, filter = {}) => {
        //Fetch histories for each sale
        const historyPromises = sales.map(sale => {
          //Fetch saleHistory
          if(filter.assetToBeSold) 
          {
            //if timeFilter is applied, also add those filters
            return saleJs.getSaleHistory(rawAdmin, { contract: sale.contract_name, ...filter  }, options);
          }else{
            //If historical data is fetched, apply 12 month timeFilter

            return saleJs.getSaleHistory(rawAdmin, { contract: sale.contract_name, assetToBeSold: originAddress, order: "block_timestamp.asc", gtField: "block_timestamp", gtValue: getOneYearAgoTime()  }, options); 
          }
        });
        const histories = await Promise.all(historyPromises);
        console.log("Histories fetched, checking for block_timestamp...");
        histories.flat().forEach((record, index) => {
          if (!record.block_timestamp) {
            console.log(`Record at index ${index} is missing block_timestamp:`, record);
          }
        });
        
        // Faltten records, process them using accumulator hash map such that for a given date we fetch latest timestamp's sale record from history table
        return histories.flat().reduce((acc, recordContainer) => {
          Object.values(recordContainer).forEach(record => {
            const date = getDate(record);
            if (!date) return;
            if (!acc[date] || acc[date].block_timestamp < record.block_timestamp) {
              acc[date] = record;
            }
          });
          return acc;
        }, {});
      };
  
      // Get the histories
      // Driver to fetch history sales for- plotting data points, stats
      const processedSalesResults = await Promise.allSettled([
        processSalesHistory(originTimeRangeSales, salesFilter),// for data points to be plotted
        processSalesHistory(originSalesForStats) // for 12-month historical data
      ]);
  
      // Handling Promise.allSettled results (Logging purposes)
      processedSalesResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          console.log(`Result ${index} fulfilled with value:`, result.value);
        } else {
          console.error(`Result ${index} rejected with reason:`, result.reason);
        }
      });

      // Time Filter Records  
      const originRecordsSorted = processedSalesResults[0].status === 'fulfilled' ? 
        Object.values(processedSalesResults[0].value).sort((a, b) => new Date(a.block_timestamp) - new Date(b.block_timestamp)) : [];
      // Only send price, timestamp as a part of the record
      const originRecords = originRecordsSorted? Object.values(originRecordsSorted).map(({price, block_timestamp}) => ({price, block_timestamp})) : [];
          
      
        
      // 12 month historical data
      const twelveMonthHistoryRecords = processedSalesResults[1].status === 'fulfilled' ? 
        Object.values(processedSalesResults[1].value).sort((a, b) => new Date(a.block_timestamp) - new Date(b.block_timestamp)) : [];
      // Only send Range, Units Sold, Average Price as the stats record
      const records = {
          originFluctuation: calculatePriceFluctuation(Object.values(twelveMonthHistoryRecords)),
          originVolume: calculateVolumeTraded(Object.values(twelveMonthHistoryRecords)),
          originAveragePrice: calculateAveragePrice(Object.values(twelveMonthHistoryRecords))
        };

    return { records, originRecords };
    } catch (error) {
      console.error("Error fetching price history:", error);
    }
  };
  

  // ------------------------------ ART STARTS ------------------------------

  contract.createArt = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    const newArgs = {
      ...args.itemArgs,
      createdDate,
      owner: rawAdmin.address,
    };
    return artJs.uploadContract(rawAdmin, newArgs, options);
  };

  contract.getArts = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName, };
    return artJs.getAll(rawAdmin, args, getOptions);
  };

  // ------------------------------ ART ENDS --------------------------------

  // ------------------------------ CARBONOFFSET STARTS------------------------------

  contract.createCarbonOffset = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    const newArgs = {
      ...args.itemArgs,
      createdDate,
    };
    return carbonOffsetJs.uploadContract(rawAdmin, newArgs, options);
  };

  contract.getCarbonOffsets = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName, };
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
    };
    return metalsJs.uploadContract(rawAdmin, newArgs, options);
  };

  contract.getMetals = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName, };
    return metalsJs.getAll(rawAdmin, args, getOptions);
  };

  // ------------------------------ MATERIALS ENDS--------------------------------

  // ------------------------------ CLOTHING STARTS------------------------------

  contract.createClothing = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    const newArgs = {
      ...args.itemArgs,
      createdDate,
    };
    return clothingJs.uploadContract(rawAdmin, newArgs, options);
  };

  contract.getClothings = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName, };
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
      status: 1,
    };
    console.log("newArgs", newArgs);
    return membershipJs.uploadContract(rawAdmin, newArgs, options);
  };

  contract.getMemberships = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName, };
    return membershipJs.getAll(rawAdmin, args, getOptions);
  };

  // ------------------------------ MEMBERSHIP ENDS--------------------------------

  // ------------------------------ CARBONDAO STARTS------------------------------

  contract.createCarbonDAO = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    const newArgs = {
      ...args.itemArgs,
      createdDate
    };
    console.log("newArgs", newArgs);
    return carbonDAOJs.uploadContract(rawAdmin, newArgs, options);
  };

  contract.getCarbonDAOs = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName, };
    return carbonDAOJs.getAll(rawAdmin, args, getOptions);
  };

  // ------------------------------ CARBONDAO ENDS--------------------------------

  // ------------------------------ COLLECTIBLES STARTS------------------------------

  contract.createCollectible = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    const newArgs = {
      ...args.itemArgs,
      createdDate,
    };
    return collectibleJs.uploadContract(rawAdmin, newArgs, options);
  };

  contract.getCollectibles = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName, };
    return collectibleJs.getAll(rawAdmin, args, getOptions);
  };

  // ------------------------------ COLLECTIBLES ENDS--------------------------------

  // ------------------------------ SALE TEST STARTS ------------------------------

  contract.createSaleOrder = async function (args, options = defaultOptions) {
    const createdDate = Math.floor(Date.now() / 1000);
    const { items, ...restArgs } = args;
    const saleAddresses = items.map(item => {
      return item.saleAddress;
    })
    const quantities = items.map(item => {
      return item.quantity;
    })

    const newArgs = {
      ...restArgs,
      saleAddresses,
      quantities,
      orderId: util.uid(),
      createdDate: createdDate,
    }
    return saleOrderJs.uploadContract(rawAdmin, newArgs, options);
  }

  contract.cancelSaleOrder = async function (args, options = defaultOptions) {
    const { saleOrderAddress, comments, ...restArgs } = args;
    const contract = { name: saleOrderJs.contractName, address: saleOrderAddress }
    return saleOrderJs.cancelOrder(rawAdmin, contract, options, comments);
  }

  contract.updateOrderStatus = async function (args, options = defaultOptions) {
    const { saleOrderAddress, status, ...restArgs } = args;
    const contract = { name: saleOrderJs.contractName, address: saleOrderAddress }
    return saleOrderJs.updateOrderStatus(rawAdmin, contract, options, status);
  }

  contract.getSaleOrders = async function (args, options = defaultOptions) {
    const getOptions = { ...options, app: contractName, };
    return saleOrderJs.getAll(rawAdmin, args, getOptions);
  }

  contract.checkSaleQuantity = async function (args, options = defaultOptions) {
    const getOptions = { ...options, app: contractName }
    return inventoryJs.checkSaleQuantity(rawAdmin, args, getOptions)
  }

  contract.getOrder = async function (args, options = defaultOptions) {
    try {
      const order = await saleOrderJs.get(rawAdmin, args, options);
      const sales = await saleJs.getAll(rawAdmin, { saleAddresses: order.saleAddresses }, options);
      let assets = [];
      
      for (const sale of sales) {
        const history = await saleJs.getSaleHistory(rawAdmin, { contract: sale.contract_name, transaction_hash: order.transaction_hash, assetToBeSold: sale.assetToBeSold }, options);
        const price = history['0'] ? history['0'].price : null;
        
        const assetAddress = sale.assetToBeSold;
        const assetWithoutQuantity = await inventoryJs.get(rawAdmin, { address: assetAddress }, options);
        
        assets.push({
          ...assetWithoutQuantity,
          price: price,
          saleQuantity: sale.quantity,
          saleAddress: sale.address,
          amount: sale.quantity * price,
        });
      }
      
      const result = { userContactAddress: order.shippingAddress, order, assets };

      return result;
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while fetching the order");
    }
  };

  contract.cancelSaleOrder = async function (args, options = defaultOptions) {
    const { saleOrderAddress, comments, ...restArgs } = args;
    const contract = { name: saleOrderJs.contractName, address: saleOrderAddress }
    return saleOrderJs.cancelOrder(rawAdmin, contract, options, comments);
  }

  contract.completeOrder = async function (args, options = defaultOptions) {
    return saleOrderJs.completeOrder(rawAdmin, args, options);
  };

  contract.updateOrderComment = async function (args, options = defaultOptions) {
    const { saleOrderAddress, comments, ...restArgs } = args;
    const contract = { name: saleOrderJs.contractName, address: saleOrderAddress }
    return saleOrderJs.updateOrderComment(rawAdmin, contract, options, comments);
  };
  
  contract.export = async function (options = defaultOptions) {
    const getOptions = { ...options, app: contractName };
    
    const processOrders = async (orderArg) => {
      const orders = await saleOrderJs.getAll(rawAdmin, orderArg, getOptions);
      if (orders.orders.length === 0) {
        return [];
      }
      const saleAddresses = orders.orders.flatMap(order => order.saleAddresses);
      const sales = await saleJs.getAll(rawAdmin, { saleAddresses }, options);
      
      const uniqueAssetAddresses = [...new Set(sales.map(sale => sale.assetToBeSold))];
      const assets = await inventoryJs.getAll(rawAdmin, { assetAddresses: uniqueAssetAddresses }, options);
      const assetLookup = new Map(assets.map(asset => [asset.address, asset]));
      
      for (const order of orders.orders) {
        const assetsPromises = order.saleAddresses.map(async (saleAddress) => {
          const sale = sales.find(sale => sale.address === saleAddress);
          if (!sale) return undefined;

          const history = await saleJs.getSaleHistory(rawAdmin, {
            contract: sale.contract_name,
            transaction_hash: order.transaction_hash,
            assetToBeSold: sale.assetToBeSold
          }, options);

          const asset = assetLookup.get(sale.assetToBeSold);
          return asset ? { ...asset, salePrice: history['0']?.price || 0 } : undefined;
        });

        order.assets = (await Promise.all(assetsPromises)).filter(asset => asset !== undefined);
      }

      return orders.orders;
    };
    
    const getItemTransferEventsWithAssetInfo = async (orderArg) => {
      const itemTransferEvents = await inventoryJs.getAllItemTransferEvents(rawAdmin, orderArg, getOptions);
      if (itemTransferEvents.transfers.length === 0) {
        return [];
      }
      const assetAddresses = itemTransferEvents.transfers.map(event => event.assetAddress);
      const uniqueAssetAddresses = [...new Set(assetAddresses)];
      const assets = await inventoryJs.getAll(rawAdmin, { assetAddresses: uniqueAssetAddresses }, getOptions);

      const assetInfoMap = new Map(assets.map(asset => [asset.address, { contract_name: asset.contract_name }]));
      return itemTransferEvents.transfers.map(event => {
        return { ...event, contract_name: assetInfoMap.get(event.assetAddress)?.contract_name };
      });
    };
    
    let soldOrderArgs = { limit: 2000, offset: 0, order: 'createdDate.desc', sellersCommonName: userCommonName };
    const soldOrders = await processOrders(soldOrderArgs);
    
    let boughtOrderArgs = { limit: 2000, offset: 0, order: 'createdDate.desc', purchasersCommonName: userCommonName };
    const boughtOrders = await processOrders(boughtOrderArgs);
    
    let transferArgs = { limit: 2000, offset: 0, order: 'transferDate.desc', or: `(oldOwnerCommonName.eq.${userCommonName},newOwnerCommonName.eq.${userCommonName})` };
    const itemTransferEvents = await getItemTransferEventsWithAssetInfo(transferArgs);
    
    return { 
      soldOrders: soldOrders ? soldOrders : [], 
      boughtOrders: boughtOrders ? boughtOrders : [], 
      transfers: itemTransferEvents ? itemTransferEvents : []
    };
  };

  // ------------------------------ SALE TEST ENDS ------------------------------

  /* ------------------------ User Activity Starts ------------------------ */
  contract.getAllUserActivity = async function (args, options = defaultOptions) {
    const getOptions = { ...options, app: contractName };
    const { sellersCommonName, purchasersCommonName, newOwnerCommonName } = args

    const currentDate = dayjs(); // Get the current date with dayjs
    const tenDaysAgoDate = currentDate.subtract(10, 'day'); // Subtract 10 days
    const tenDaysAgoTimestamp = tenDaysAgoDate.utc().format('YYYY-MM-DD HH:mm:ss') + ' UTC'; // Format the date

    // Need to fetch purchases, closed orders, transfers for the user.
    // New Purchases of User's Products---Fetch Orders with filters of sellersCommonName, block_timestamp and Order Status = AWAITING_FULFILLMENT (1) 
    const purchaseArgs = { sellersCommonName, status: 1, gtField: "block_timestamp", gtValue: tenDaysAgoTimestamp}
    const purchases = await saleOrderJs.getAll(rawAdmin, purchaseArgs, getOptions);

    // These are my orders that ave been closed by a seller
    const orderArgs = { purchasersCommonName, status: 3, gtField: "block_timestamp", gtValue: tenDaysAgoTimestamp}
    const orders = await saleOrderJs.getAll(rawAdmin, orderArgs, getOptions);

    // These are transfers the usre has recieved
    const transferArgs = {newOwnerCommonName, gtField: "block_timestamp", gtValue: tenDaysAgoTimestamp};
    const transfers = await inventoryJs.getAllItemTransferEvents(rawAdmin, transferArgs, getOptions);

    // Fetch activities and add type to each item
    const purchasesWithTypes = purchases.orders.map(p => ({ ...p, type: 'sold' }));
    const ordersWithTypes = orders.orders.map(o => ({ ...o, type: 'bought' }));
    const transfersWithTypes = transfers.transfers.map(t => ({ ...t, type: 'transfer' }));

    // Combine all activities into one array
    const allActivities = [...purchasesWithTypes, ...ordersWithTypes, ...transfersWithTypes];
    // Sort by block_timestamp
    allActivities.sort((a, b) => new Date(b.block_timestamp) - new Date(a.block_timestamp));

    return allActivities;
  };

  /* ------------------------ User Activity Ends------------------------ */


  /* ------------------------ Stripe account connect starts here ------------------------ */
  contract.stripeOnboarding = async function (args, options = defaultOptions) {
    try {
      const getOptions = { ...options, app: contractName };
      let userStripeAccount, connectLink;
      // get user paymentProvider details from cirrus
      const sellerStripeDetails = await paymentProviderJs.get(rawAdmin, { name: 'STRIPE', accountDeauthorized: false, ownerCommonName: userCert.commonName }, getOptions)
      if (sellerStripeDetails.length == 0 || Object.keys(sellerStripeDetails[0]).length == 0) {
        await axios.get(new URL('/stripe/onboard', STRIPE_PAYMENT_SERVER_URL).href)
          .then(async function (res) {
            if (res.status === 200) {
              const { accountDetails } = res.data;
              userStripeAccount = accountDetails.accountId;
              await paymentProviderJs.uploadContract(rawAdmin, accountDetails, options);
              connectLink = res.data.connectLink;
            } else {
              throw new rest.RestError(RestStatus.BAD_REQUEST, `Payment server call failed: ${res.statusText}`);
            }
          });
      } else {
        await axios.get(new URL(`/stripe/onboard/${sellerStripeDetails[0].accountId}`, STRIPE_PAYMENT_SERVER_URL).href)
          .then(function (res) {
            if (res.status === 200) {
              connectLink = res.data.connectLink;
            } else {
              throw new rest.RestError(RestStatus.BAD_REQUEST, `Payment server call failed: ${res.statusText}`);
            }
          });
      }
      return connectLink
    } catch (error) {
      console.error(`${error}`)
      throw new rest.RestError(RestStatus.BAD_REQUEST, `${error.message}`)
    }
  }

  contract.getStripeOnboardingStatus = async function (args, options = defaultOptions) {
    try {
      const getOptions = { ...options, app: contractName };

      // get user paymentProvider details from cirrus
      const paymentProviders = await paymentProviderJs.get(rawAdmin, { name: 'STRIPE', accountDeauthorized: false, ...args }, getOptions);
      /* TODO check if the provider contract exists on then initiate a update */
      if (paymentProviders.length == 0 || Object.keys(paymentProviders[0]).length == 0) {
        // throw new rest.RestError(RestStatus.NOT_FOUND, "User hasn't started their stripe setup.")
        return {}
      }

      let returnedStripeAccountStatus = paymentProviders[0];
      let paymentMethodsChecked = [];
      for (const paymentProvider of paymentProviders) {
        if (paymentProvider.name in paymentMethodsChecked) {
          continue;
        }
        else {
          const connectedStripeAccountStatus = { chargesEnabled: false, detailsSubmitted: false, payoutsEnabled: false, accountDeauthorized: false, eventTime: Date.now() }
          const paymentProviderContract = { name: paymentProviderJs.contractName, address: paymentProvider.address }
          try {
            await axios.get(new URL(`/stripe/status/${paymentProvider.accountId}`, STRIPE_PAYMENT_SERVER_URL).href)
              .then(function (res) {
                if (res.status === 200) {
                  connectedStripeAccountStatus.chargesEnabled = res.data.chargesEnabled;
                  connectedStripeAccountStatus.detailsSubmitted = res.data.detailsSubmitted;
                  connectedStripeAccountStatus.payoutsEnabled = res.data.payoutsEnabled;
                } else {
                  throw new rest.RestError(RestStatus.BAD_REQUEST, `Payment server call failed: ${res.statusText}`);
                }
              }, (error) => {
                console.log(error);
              });
          } catch (error) {
            if (error.code == 'account_invalid') {
              connectedStripeAccountStatus.accountDeauthorized = true
            }
          }
          const { detailsSubmitted, chargesEnabled, payoutsEnabled, accountDeauthorized } = connectedStripeAccountStatus;
          if (paymentProvider.detailsSubmitted !== detailsSubmitted || paymentProvider.chargesEnabled !== chargesEnabled || paymentProvider.payoutsEnabled !== payoutsEnabled || paymentProvider.accountDeauthorized !== accountDeauthorized) {
            await paymentProviderJs.updatePaymentProvider(rawAdmin, paymentProviderContract, connectedStripeAccountStatus, options);
          }

          if (connectedStripeAccountStatus.detailsSubmitted
            && connectedStripeAccountStatus.chargesEnabled
            && connectedStripeAccountStatus.payoutsEnabled
          ) {
            returnedStripeAccountStatus = {
              accountId: paymentProvider.accountId,
              paymentProviderAddress: paymentProvider.address,
              ...connectedStripeAccountStatus
            }
          }

          paymentMethodsChecked.push(paymentProvider.name);
        }

        return returnedStripeAccountStatus
      }
    } catch (error) {
      console.error(`${error}`)
      throw new rest.RestError(RestStatus.BAD_REQUEST, `${error.message}`)
    }
  }

  contract.updateStripeOnboardingStatus = async function (args, options = defaultOptions) {
    try {
      // get user paymentProvider details from cirrus
      const { accountId, ...restArgs } = args

      const getOptions = { ...options, app: contractName };
      const chainOptions = { ...options, chainIds: [contract.chainId] };

      const paymentProvider = await paymentProviderJs.get(rawAdmin, { name: 'STRIPE', accountId }, getOptions);

      /* TODO check if the provider contract exists on then initiate a update */
      if (!paymentProvider) {
        // throw new rest.RestError(RestStatus.NOT_FOUND, "User hasn't started their stripe setup.")
        return false
      }

      if (paymentProvider[0].eventTime > eventTime) {
        return true;
      }

      const paymentProviderContract = { name: paymentProviderJs.contractName, address: paymentProvider.address }
      await paymentProviderJs.updatePaymentProvider(rawAdmin, paymentProviderContract, restArgs, chainOptions);

    } catch (error) {
      console.error(error);
      throw new rest.RestError(error.response.status, error.response.statusText)
    }
  }
  // //-----------------------------PAYMENT starts here -------------------------------

  contract.paymentCheckout = async function (originUrl, args, options = defaultOptions) {
    try {

      const { orderList, orderTotal: recievedOrderTotal } = args;

      const assetAddresses = orderList.map(o => o.assetAddress);

      const assets = await inventoryJs.getAll(rawAdmin, { assetAddresses: assetAddresses }, options);

      const saleAddresses = assets.map(a => a.saleAddress);

      if (assets.length == 0 || assets.length != orderList.length) {
        throw new rest.RestError(RestStatus.NOT_FOUND, "Inventory not found")
      }

      const sellerName = assets[0].ownerCommonName;
      for (const currInventory of assets) {

        if (currInventory.ownerCommonName == userCert.commonName) {
          throw new rest.RestError(RestStatus.BAD_REQUEST, "Seller cannot buy his own product",);
        }

        /* User shouldn't be allowed buy products from multiple sellers  */
        if (sellerName != currInventory.ownerCommonName) {
          throw new rest.RestError(RestStatus.BAD_REQUEST, "Cannot buy products from multiple sellers in the same Order/Checkout",);
        }
      }
      // const chainOptions = { ...options, chainIds: [contract.chainId] };
      const sellerStripeDetails = await paymentProviderJs.get(rawAdmin,
        {
          name: 'STRIPE', ownerCommonName: sellerName,
          accountDeauthorized: false
        },
        options)

      /*  check if an accountId already exists for the user org */
      if (sellerStripeDetails.length === 0 || !sellerStripeDetails[0].chargesEnabled || !sellerStripeDetails[0].detailsSubmitted || !sellerStripeDetails[0].payoutsEnabled) {
        throw new rest.RestError(RestStatus.CONFLICT, "Seller hasn't activated this payment method");
      }

      const invoices = [];
      let calculatedOrderTotal = 0;

      orderList.forEach(item => {
        const inventoryItem = assets.find(asset => asset.address == item.assetAddress);
        invoices.push({ productName: decodeURIComponent(inventoryItem.name), unitPrice: inventoryItem.price, quantity: item.quantity });

        calculatedOrderTotal += (inventoryItem.price * item.quantity);
      })

      if (calculatedOrderTotal != recievedOrderTotal) {
        throw new rest.RestError(RestStatus.BAD_REQUEST, "Incorrect order value.");
      }
      let stripePaymentSession;
      const { paymentList, ...restArgs } = args;
      try {
        const checkoutBody = {
          paymentTypes: paymentList,
          cartData: restArgs,
          orderDetail: invoices,
          accountId: sellerStripeDetails[0].accountId,
        }
        stripePaymentSession = await axios.post(new URL('/stripe/checkout', STRIPE_PAYMENT_SERVER_URL).href, checkoutBody, {
          headers: {
            'referer': `${originUrl}`
          }
        })
          .then(function (res) {
            if (res.status === 200) {
              return res.data;
            } else {
              throw new rest.RestError(RestStatus.BAD_REQUEST, `Payment server call failed: ${res.statusText}`);
            }
          });
      } catch (err) {
        throw new rest.RestError(err.statusCode, err.message);
      }
      const paymentParameters = {
        address: sellerStripeDetails[0].address,
        saleAddresses,
        paymentSessionId: stripePaymentSession.id,
        paymentStatus: stripePaymentSession.payment_status,
        sessionStatus: stripePaymentSession.status,
        amount: stripePaymentSession.amount_total.toString(),
        expiresAt: stripePaymentSession.expires_at,
        createdDate: stripePaymentSession.created,
      }
      await paymentProviderJs.createPayment(rawAdmin, paymentParameters, options);
      return stripePaymentSession;

    } catch (error) {
      console.log(error);
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while updating the order");
    }
  };

  // Stripe Webhook TODO

  contract.updatePayment = async function (args, options = defaultOptions, token) {
    try {
      return paymentProviderJs.finalizePayment(args, options)
    } catch (error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while updating payment status", { message: "Error while updating payment status" })
    }
  };

  // Stripe Webhook End

  contract.getPaymentSession = async function (args, options = defaultOptions) {
    try {
      const { session_id, sellersCommonName } = args;
      const paymentDetail = await paymentProviderJs.get(rawAdmin,
        { name: 'STRIPE', ownerCommonName: sellersCommonName, accountDeauthorized: false },
        options);
      if (paymentDetail.length === 0) {
        throw new rest.RestError(RestStatus.CONFLICT, "Seller payment details cannot be found.");
      }
      const paymentSession = await axios.get(new URL(`/stripe/session/${session_id}/${paymentDetail[0].accountId}`, STRIPE_PAYMENT_SERVER_URL).href)
        .then(function (res) {
          if (res.status === 200) {
            return res.data;
          } else {
            throw new rest.RestError(RestStatus.BAD_REQUEST, `Payment server call failed: ${res.statusText}`);
          }
        });
      return { ...paymentSession }
    } catch (error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while fetching payment session", { message: "Error while fetching payment" })
    }
  };

  contract.getPaymentIntent = async function (args, options = defaultOptions) {
    try {
      const { session_id, sellersCommonName } = args;
      const paymentDetail = await paymentProviderJs.get(rawAdmin,
        { name: 'STRIPE', ownerCommonName: sellersCommonName, accountDeauthorized: false },
        options);
      if (paymentDetail.length === 0) {
        throw new rest.RestError(RestStatus.CONFLICT, "Seller payment details cannot be found.");
      }
      const paymentIntent = await axios.get(new URL(`/stripe/intent/${session_id}/${paymentDetail[0].accountId}`, STRIPE_PAYMENT_SERVER_URL).href)
        .then(function (res) {
          if (res.status === 200) {
            return res.data;
          } else {
            throw new rest.RestError(RestStatus.BAD_REQUEST, `Payment server call failed: ${res.statusText}`);
          }
        });
      return { ...paymentIntent }
    } catch (error) {
      throw new rest.RestError(RestStatus.BAD_REQUEST, "Error while fetching payment intent", { message: "Error while fetching payment intent" })
    }
  };

  contract.createUserAddress = async function (args, options = defaultOptions) {
    try {
      await axios.post(new URL(`/customer/address`, STRIPE_PAYMENT_SERVER_URL).href, { commonName: userCert.commonName, ...args })
        .then(function (res) {
          if (res.status === 200) {
            console.log(res.data);
          } else {
            throw new rest.RestError(RestStatus.BAD_REQUEST, `Payment server call failed: ${res.statusText}`);
          }
        });
      return {}
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, `Error while adding address: ${JSON.stringify(error)} `);
    }
  };

  contract.getAllUserAddress = async function (args, options = optionsNoChainIds) {
    try {
      const userAddresses = await axios.get(new URL(`/customer/address/${userCert.commonName}`, STRIPE_PAYMENT_SERVER_URL).href).then(function (res) {
        if (res.status === 200) {
          return res.data.data;
        } else {
          throw new rest.RestError(RestStatus.BAD_REQUEST, `Payment server call failed: ${res.statusText}`);
        }
      });
      return userAddresses;
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, `Error while fetching addresses: ${JSON.stringify(err)} `);
    }
  };

  contract.getAddressFromId = async function (args, options = defaultOptions) {
    try {
      const { id } = args;
      const userAddress = await axios.get(new URL(`/customer/address/id/${id}`, STRIPE_PAYMENT_SERVER_URL).href).then(function (res) {
        if (res.status === 200) {
          return res.data.data;
        } else {
          throw new rest.RestError(RestStatus.BAD_REQUEST, `Payment server call failed: ${res.statusText}`);
        }
      });
      return userAddress;
    } catch (error) {
      if (error.response) {
        throw new rest.RestError(error.response.status, error.response.statusText);
      }
      throw new rest.RestError(RestStatus.BAD_REQUEST, `Error while fetching address: ${JSON.stringify(err)} `);
    }
  };

  contract.getStratsBalance = async function (args, options = defaultOptions) {
    const { userAddress } = args;
    const getOptions = { ...options, org: "TestCompany", app: '' };
    let address;

    if (process.env.networkID === constants.prodNetworkId) {
      address = constants.prodStratsAddress
    } else if (process.env.networkID === constants.testnetNetworkId) {
      address = constants.testnetStratsAddress
    } else {
      address = constants.prodStratsAddress
    }

    const newArgs = {
      address: address,
      key: userAddress
    }

    const balance = await strats.getStratsBalance(rawAdmin, newArgs, getOptions);
    return balance;
  }

  return contract;
};

/**
 * Add a new organization to a tCommerce contract/chain.
 * @param {string} orgName The new organization to add
 */
async function addOrg(user, contract, options, orgName) {
  const callArgs = { contract, method: "addOrg", args: util.usc({ orgName }), };
  return rest.call(user, callArgs, options);
}

/**
 * Add a new organization unit to a tCommerce contract/chain.
 * @param {string} orgName The organization the unit to add belongs to
 * @param {string} orgUnit The new organization unit to add
 */
async function addOrgUnit(user, contract, options, orgName, orgUnit) {
  const callArgs = { contract, method: "addOrgUnit", args: util.usc({ orgName, orgUnit }), };
  return rest.call(user, callArgs, options);
}

/**
 * Add a new member to a tCommerce contract/chain.
 * @param {string} orgName The organization the member to add belongs to
 * @param {string} orgUnit The organization unit the member to add belongs to
 * @param {string} commonName The common name of the member to add
 */
async function addMember(user, contract, options, orgName, orgUnit, commonName) {
  const callArgs = { contract, method: "addMember", args: util.usc({ orgName, orgUnit, commonName }), };
  return rest.call(user, callArgs, options);
}

/**
 * Remove an existing organization from a tCommerce contract/chain.
 * @param {string} orgName The organization to remove
 */
async function removeOrg(user, contract, options, orgName) {
  const callArgs = { contract, method: "removeOrg", args: util.usc({ orgName }), };
  return rest.call(user, callArgs, options);
}

/**
 * Remove an existing organization unit from a tCommerce contract/chain.
 * @param {string} orgName The organization the unit to remove belongs to
 * @param {string} orgUnit The organization unit to remove
 */
async function removeOrgUnit(user, contract, options, orgName, orgUnit) {
  const callArgs = { contract, method: "removeOrgUnit", args: util.usc({ orgName, orgUnit }), };
  return rest.call(user, callArgs, options);
}

/**
 * Remove an existing member from a tCommerce contract/chain.
 * @param {string} orgName The organization the member to remove belongs to
 * @param {string} orgUnit The organization unit the member to remove belongs to
 * @param {string} commonName The common name of the member to remove
 */
async function removeMember(user, contract, options, orgName, orgUnit, commonName) {
  const callArgs = { contract, method: "removeMember", args: util.usc({ orgName, orgUnit, commonName }), };
  return rest.call(user, callArgs, options);
}

/**
 * Add multiple new organizations to a tCommerce contract/chain.
 * @param {string} orgNames An array of new organizations to add
 */
async function addOrgs(user, contract, options, orgNames) {
  const callArgs = { contract, method: "addOrgs", args: util.usc({ orgNames }), };
  return rest.call(user, callArgs, options);
}

/**
 * Add multiple new organization units to a tCommerce contract/chain.
 * @param {string} orgNames An array of organizations the units to add belongs to
 * @param {string} orgUnits An array of new organization units to add
 */
async function addOrgUnits(user, contract, options, orgNames, orgUnits) {
  const callArgs = { contract, method: "addOrgUnits", args: util.usc({ orgNames, orgUnits }), };
  return rest.call(user, callArgs, options);
}

/**
 * Add multiple new members to a tCommerce contract/chain.
 * @param {string} orgNames An array of organizations the units to add belongs to
 * @param {string} orgUnits An array of organization units the members to add belongs to
 * @param {string} commonNames An array of the common names of the members to add
 */
async function addMembers(user, contract, options, orgNames, orgUnits, commonNames) {
  const callArgs = { contract, method: "addMembers", args: util.usc({ orgNames, orgUnits, commonNames }), };
  return rest.call(user, callArgs, options);
}

/**
 * Remove multiple existing organizations from a tCommerce contract/chain.
 * @param {string} orgNames An array of organizations to remove
 */
async function removeOrgs(user, contract, options, orgNames) {
  const callArgs = { contract, method: "removeOrgs", args: util.usc({ orgNames }), };
  return rest.call(user, callArgs, options);
}

/**
 * Remove multiple existing organization units from a tCommerce contract/chain.
 * @param {string} orgNames An array of organizations the units to remove belongs to
 * @param {string} orgUnits An array of organization units to remove
 */
async function removeOrgUnits(user, contract, options, orgNames, orgUnits) {
  const callArgs = { contract, method: "removeOrgUnits", args: util.usc({ orgNames, orgUnits }), };
  return rest.call(user, callArgs, options);
}

/**
 * Remove multiple existing members from a tCommerce contract/chain.
 * @param {string} orgNames An array of organizations the units to remove belongs to
 * @param {string} orgUnits An array of organization units the members to remove belongs to
 * @param {string} commonNames An array of the common names of the members to remove
 */
async function removeMembers(user, contract, options, orgNames, orgUnits, commonNames) {
  const callArgs = { contract, method: "removeMembers", args: util.usc({ orgNames, orgUnits, commonNames }), };
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
    console.error("Error getting chainInfo:", e);
  }

  const filtered = chains.reduce((acc, c) => {
    const member = c.info.members.find((m) => { return m.address === keyResponse; });
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
  uploadDappContract
};
