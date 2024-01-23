import { rest, util, importer } from "blockapps-rest";
const { createContract } = rest;
import { SERVICE_PROVIDERS, STRIPE_PAYMENT_SERVER_URL } from "/helpers/constants";
import { yamlWrite, yamlSafeDumpSync, getYamlFile } from "/helpers/config";
import { pollingHelper } from "/helpers/utils";

import axios from 'axios';
import dayjs from 'dayjs';
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

const allAssetNames = [];

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
  console.log(options);
  // author the deployment
  const { deployFilePath } = args;

  const deployment = {
    url: options.config.nodes[0].url,
    dapp: {
      contract: {
        name: contract.name,
        address: contract.address
      },
    },
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
    const newArgs = { ...args, notEqualsField: 'sale', notEqualsValue: '0000000000000000000000000000000000000000' }
    return marketplaceJs.getAll(rawAdmin, newArgs, getOptions);
  };

  contract.getMarketplaceInventoriesLoggedIn = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName };
    const newArgs = {
      ...args, notEqualsField: ['sale', 'ownerCommonName'],
      notEqualsValue: ['0000000000000000000000000000000000000000', userCommonName]
    }

    return marketplaceJs.getAll(rawAdmin, newArgs, getOptions);
  };

  contract.getTopSellingProducts = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName }
    const newArgs = { ...args, notEqualsField: 'sale', notEqualsValue: '0000000000000000000000000000000000000000' }
    return marketplaceJs.getTopSellingProducts(rawAdmin, newArgs, getOptions)
  }

  contract.getTopSellingProductsLoggedIn = async function (args = {}, options = optionsNoChainIds) {
    const getOptions = { ...options, app: contractName }
    const newArgs = {
      ...args, notEqualsField: ['sale', 'ownerCommonName'],
      notEqualsValue: ['0000000000000000000000000000000000000000', userCommonName]
    }
    return marketplaceJs.getTopSellingProducts(rawAdmin, newArgs, getOptions)
  }

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
    /*
    const sales = await saleJs.getAll(rawAdmin, { assetAddresses, paymentMethod }, options);
    const sellersAddress = sales[0].sellersAddress;
    const sellersCommonName = sales[0].sellersCommonName;
    const saleAddresses = await Promise.all(sales.map(async (sale) => {
      const orderForSale = orderList.find(order => order.assetAddress === sale.assetToBeSold);
      const saleData = sale.data;
      if (saleData.units && orderForSale.quantity < saleData.units) {
        const contract = { name: orderForSale.category, address: orderForSale.assetAddress }
        const splitSaleAddress = await saleJs.createSplitSale(rawAdmin, {
          paymentType: parseInt(PAYMENT_TYPES[paymentMethod]),
          price: sale.price,
          units: orderForSale.quantity,
        }, options, contract);
        return splitSaleAddress;
      }
      else {
        return sale.address;
      }
    }));
    */
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

  contract.getOrder = async function (args, options = defaultOptions) {
    try {
      const order = await saleOrderJs.get(rawAdmin, args, options);
      const sales = await saleJs.getAll(rawAdmin, { saleAddresses: order.saleAddresses }, options);
      const assetAddresses = sales.map(sale => {
        return sale.assetToBeSold;
      })
      let assets = [];
      const assetsWithoutQuantity = await inventoryJs.getAll(rawAdmin, { assetAddresses: assetAddresses }, options);
      assetsWithoutQuantity.map(asset => {
        const saleForAsset = sales.find(sale => sale.assetToBeSold === asset.address);
        assets.push({
          ...asset,
          price: saleForAsset.price,
          saleQuantity: saleForAsset.quantity,
          saleAddress: saleForAsset.address,
          amount: saleForAsset.quantity * saleForAsset.price,
        })
      })
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

  // ------------------------------ SALE TEST ENDS ------------------------------


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

  contract.paymentCheckout = async function (args, options = defaultOptions) {
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
        stripePaymentSession = await axios.post(new URL('/stripe/checkout', STRIPE_PAYMENT_SERVER_URL).href, checkoutBody)
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
