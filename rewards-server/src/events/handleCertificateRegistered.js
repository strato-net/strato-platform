const { NODE, prodStratsAddress, testnetStratsAddress } = require("../config");
// const contractName = 'ERC20Dapp';
// // includes the org+app for cirrus namespacing (helpers/utils.js will prepend to cirrus queries)
// const defaultOptions = { ..._defaultOptions, app: "Mercata", chainIds: [], cacheNonce: true };

// async function transferStrats(admin, args, options = defaultOptions) {
//   const address = getStratsAddress();
//   const contract = {
//     name: contractName,
//     address,
//   }
//   const callArgs = {
//     contract,
//     method: 'transfer',
//     args: util.usc(args),
//   };
//   return rest.call(admin, callArgs, options);
// }

function getStratsAddress() {
  if (NODE === "prod") {
    return prodStratsAddress
  } else if (NODE === "testnet") {
    return testnetStratsAddress
  } else {
    return prodStratsAddress
  }
}

async function handleCertificateRegistered(event) {
  console.log("OwnershipTransfer event received:", event);
  const payload = {
    to: receiverAddress,
    value: amount !== undefined ? amount * 100 : 0
  };
  // await transferStrats(admin, payload, options);
}

module.exports = { handleCertificateRegistered };
