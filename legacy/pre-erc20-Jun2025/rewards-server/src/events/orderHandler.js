const { createTransactionPayload } = require("../helper/transferUSDST");
const {
  NODE_ENV,
  prodMarketplaceUrl,
  testnetMarketplaceUrl,
  notificationUrl
} = require("../config");
const { getRewards } = require("../helper/googleSheet.js");
const axios = require("axios");
const { sendEmail, getUserName } = require("../helper/utils.js");

const baseUrl = NODE_ENV === "prod" ? prodMarketplaceUrl : testnetMarketplaceUrl;

async function handleOrderRewards(event, token) {
  const purchaser = {
    purchaserAddress: event.eventEvent.eventArgs.find(
      (arg) => arg[0] === "purchaser"
    )?.[1],
    purchasersCommonName: event.eventEvent.eventArgs.find(
      (arg) => arg[0] === "purchasersCommonName"
    )?.[1]
  };

  const seller = {
    sellerAddress: event.eventEvent.eventArgs.find(
      (arg) => arg[0] === "sellerAddress"
    )?.[1],
    sellersCommonName: event.eventEvent.eventArgs.find(
      (arg) => arg[0] === "sellersCommonName"
    )?.[1]
  };

  const status = event.eventEvent.eventArgs.find(
    (arg) => arg[0] === "status"
  )?.[1];

  if (!purchaser) {
    console.error("No purchaser or seller found in event args");
    return;
  }

  if (status !== "3") {
    console.log(
      "Order status is not 3, skipping reward because it's most likely an ACH pending."
    );
    return;
  }

  const orderTotal = parseFloat(
    event.eventEvent.eventArgs.find((arg) => arg[0] === "amount")?.[1] || 0
  );

  // Check if the purchaser has made a first order before
  const checkFirstPurchase = await axios.get(
    `https://${baseUrl}/cirrus/search/BlockApps-Mercata-PaymentService.Order`,
    {
      params: {
        purchaser: `eq.${purchaser.purchaserAddress}`,
        status: 'eq.3',
        select: 'count'
      },
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      }
    }
  );

  const queryBody = checkFirstPurchase.data;

  let eventKey = "RegularOrder";

  if (queryBody[0].count === 1) {
    console.log("User's first order");
    sendEmail(baseUrl, notificationUrl, 'firstPurchase', purchaser.purchasersCommonName, token);
    eventKey = "FirstOrder";
  }

  // Getting both rewards to reduce calls to Google API.
  const eventKeys = [eventKey, "RegularSale"];
  const getAllRewards = await getRewards(eventKeys);

  const buyerRewardStr = getAllRewards[eventKey];
  const sellerRewardStr = getAllRewards["RegularSale"];

  if (!buyerRewardStr || !sellerRewardStr) {
    console.error("Failed to get valid reward percentages.");
    return;
  }

  // Adding support for percentage as a string or decimal (e.g. "0.05" or "5%")
  let buyerRewardPercent, sellerRewardPercent;

  if (buyerRewardStr.includes("%")) {
    buyerRewardPercent = parseFloat(buyerRewardStr.replace("%", "")) / 100;
  } else {
    buyerRewardPercent = parseFloat(buyerRewardStr);
  }

  if (sellerRewardStr.includes("%")) {
    sellerRewardPercent = parseFloat(sellerRewardStr.replace("%", "")) / 100;
  } else {
    sellerRewardPercent = parseFloat(sellerRewardStr);
  }

  if (isNaN(buyerRewardPercent) || isNaN(sellerRewardPercent)) {
    console.error("Failed to get valid reward percentages.");
    return;
  }

  let buyerReward = orderTotal * buyerRewardPercent;
  let sellerReward = orderTotal * sellerRewardPercent;

  buyerReward *= 10000; // Multiply by 10000 to handle rounding errors (1000) and then USDST conversion (100).
  sellerReward *= 10000; // Multiply by 10000 to handle rounding errors (1000) and then USDST conversion (100).

  // Round the reward amounts to ensure they're integers
  buyerReward = Math.round(buyerReward);
  sellerReward = Math.round(sellerReward);

  await handleOrderReward(
    seller,
    sellerReward,
    purchaser,
    buyerReward,
    token,
    eventKey
  );
}

async function handleOrderReward(
  seller,
  sellerReward,
  purchaser,
  buyerReward,
  token,
  eventKey
) {
  try {
    console.log(
      `Sending ${eventKey} reward to , ${purchaser.purchasersCommonName}, ${buyerReward / 100}USDST`
    );
    console.log(
      `Sending sale reward to , ${seller.sellersCommonName}, ${sellerReward / 100}USDST`
    );

    const transactions = [
      {toAddress: seller.sellerAddress, value: sellerReward },
      {toAddress: purchaser.purchaserAddress, value: buyerReward }
    ];

    const transactionResponse = await createTransactionPayload(
      token,
      transactions
    );

    if (transactionResponse.status !== 200) {
      const errorText = await transactionResponse.text();
      console.error(
        `Error: ${transactionResponse.status} ${transactionResponse.statusText}`
      );
      console.error(`Response body: ${errorText}`);
      throw new Error(
        `Transaction failed with status ${transactionResponse.status}: ${transactionResponse.statusText}`
      );
    }

    const response = await transactionResponse.data;
    const allSuccessful = response.every((tx) => tx.status === "Success");
    if (allSuccessful) {
      console.log("All reward transactions were successful:", response);

      // To Purchaser
      sendEmail(baseUrl, notificationUrl, 'additionalPurchase', purchaser.purchasersCommonName, token);

      // To Seller
      sendEmail(baseUrl, notificationUrl, 'sellerReward', seller.sellersCommonName, token);

    } else {
      console.log("Some reward transactions were not successful:", response);
    }
    return response;
  } catch (error) {
    console.log(
      `Failed to send ${eventKey} reward to ${purchaser.purchasersCommonName}, ${buyerReward / 100}USDST`
    );
    console.log(
      `Failed to send sale reward to ${seller.sellersCommonName}, ${sellerReward / 100}USDST`
    );
    console.error("Error processing transaction:", error.message);
    throw error;
  }
}

module.exports = { handleOrderRewards };
