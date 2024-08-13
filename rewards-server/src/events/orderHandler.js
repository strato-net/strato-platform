const { createTransactionPayload } = require("../helper/transferSTRATS");
const {
  NODE,
  prodMarketplaceUrl,
  testnetMarketplaceUrl,
} = require("../config");
const { getRewards } = require("../helper/googleSheet.js");

async function handleOrderRewards(event, token) {
  const purchaser = event.eventEvent.eventArgs.find(
    (arg) => arg[0] === "purchaser"
  )?.[1];

  const seller = event.eventEvent.eventArgs.find(
    (arg) => arg[0] === "sellerAddress"
  )?.[1];

  if (!purchaser) {
    console.error("No purchaser or seller found in event args");
    return;
  }

  const orderTotal = parseFloat(
    event.eventEvent.eventArgs.find((arg) => arg[0] === "amount")?.[1] || 0
  );

  // Check if the purchaser has made a first order before
  const checkFirstPurchase = await fetch(
    `https://${
      NODE === "prod" ? prodMarketplaceUrl : testnetMarketplaceUrl
    }/cirrus/search/BlockApps-Mercata-PaymentService.Order?purchaser=eq.${purchaser}&status=eq.3&select=count`,
    {
      method: "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    }
  );

  const queryBody = await checkFirstPurchase.json();

  let eventKey = "RegularOrder";

  if (queryBody[0].count === 1) {
    console.log("User's first order");
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
    buyerRewardPercent =
      parseFloat(buyerRewardStr.replace("%", "")) / 100;
  } else {
    buyerRewardPercent = parseFloat(buyerRewardStr);
  }

  if (sellerRewardStr.includes("%")) {
    sellerRewardPercent =
      parseFloat(sellerRewardStr.replace("%", "")) / 100;
  } else {
    sellerRewardPercent = parseFloat(sellerRewardStr);
  }

  if (isNaN(buyerRewardPercent) || isNaN(sellerRewardPercent)) {
    console.error("Failed to get valid reward percentages.");
    return;
  }

  let buyerReward = orderTotal * buyerRewardPercent;
  let sellerReward = orderTotal * sellerRewardPercent;

  buyerReward *= 10000; // Multiply by 10000 to handle rounding errors (1000) and then STRATS conversion (100).
  sellerReward *= 10000; // Multiply by 10000 to handle rounding errors (1000) and then STRATS conversion (100).

  // Round the reward amounts to ensure they're integers
  buyerReward = Math.round(buyerReward);
  sellerReward = Math.round(sellerReward);

  await handlePurchaserReward(purchaser, buyerReward, token)
  await handleSellerReward(seller, sellerReward, token)

}

async function handlePurchaserReward(purchaser, reward, token) {
  try {
    const purchaserResponse = await createTransactionPayload(
      token,
      purchaser,
      reward
    );
    if (!purchaserResponse.ok) {
      const errorText = await purchaserResponse.text();
      console.error(
        `Error: ${purchaserResponse.status} ${purchaserResponse.statusText}`
      );
      console.error(`Response body: ${errorText}`);
      throw new Error(
        `Purchaser transaction failed with status ${purchaserResponse.status}: ${purchaserResponse.statusText}`
      );
    }

    const response = await purchaserResponse.json();
    console.log("Purchaser reward transaction successful:", response);
    return response;
  } catch (error) {
    console.error("Error processing purchaser transaction:", error.message);
    throw error;
  }
}

async function handleSellerReward(seller, reward, token) {
    try {
      const sellerResponse = await createTransactionPayload(
        token,
        seller,
        reward
      );
      if (!sellerResponse.ok) {
        const errorText = await sellerResponse.text();
        console.error(
          `Error: ${sellerResponse.status} ${sellerResponse.statusText}`
        );
        console.error(`Response body: ${errorText}`);
        throw new Error(
          `Seller transaction failed with status ${sellerResponse.status}: ${sellerResponse.statusText}`
        );
      }
      
      const response = await sellerResponse.json();
      console.log("Seller reward transaction successful:", response);
      return response
    } catch (error) {
      console.error("Error processing seller transaction:", error.message);
      throw error; 
    }
}

module.exports = { handleOrderRewards };
