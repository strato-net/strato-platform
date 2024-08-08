const { createTransactionPayload } = require("../helper/transferSTRATS");
const {
  NODE,
  prodMarketplaceUrl,
  testnetMarketplaceUrl,
} = require("../config");
const { getRewardsAmount } = require("../helper/googleSheet.js");

async function handleOrderRewards(event, token) {
  const purchaser = event.eventEvent.eventArgs.find(
    (arg) => arg[0] === "purchaser"
  )?.[1];

  const seller = event.eventEvent.eventArgs.find(
    (arg) => arg[0] === "sellerAddress"
  )?.[1];

  if (!purchaser || !seller) {
    console.error("No purchaser or seller found in event args");
    return;
  }

  const totalAmount = parseFloat(
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

  if (queryBody[0].count === 0) {
    console.log("User's first order");
    eventKey = "FirstOrder";
  }

  const eventKeys = [eventKey, "RegularSale"];
  const rewardAmounts = await getRewardsAmount(eventKeys);

  const buyerRewardPercentageStr = rewardAmounts[eventKey];
  const sellerRewardPercentageStr = rewardAmounts["RegularSale"];

  if (!buyerRewardPercentageStr || !sellerRewardPercentageStr) {
    console.error("Failed to get valid reward percentages.");
    return;
  }

  let buyerRewardPercentage, sellerRewardPercentage;
  // Adding support for percentage as a string or a number (e.g. "0.05" or "5%")
  if (buyerRewardPercentageStr.includes("%")) {
    buyerRewardPercentage =
      parseFloat(buyerRewardPercentageStr.replace("%", "")) / 100;
  } else {
    buyerRewardPercentage = parseFloat(buyerRewardPercentageStr);
  }

  if (sellerRewardPercentageStr.includes("%")) {
    sellerRewardPercentage =
      parseFloat(sellerRewardPercentageStr.replace("%", "")) / 100;
  } else {
    sellerRewardPercentage = parseFloat(sellerRewardPercentageStr);
  }

  if (isNaN(buyerRewardPercentage) || isNaN(sellerRewardPercentage)) {
    console.error("Failed to get valid reward percentages.");
    return;
  }

  let buyerRewardAmount = totalAmount * buyerRewardPercentage;
  let sellerRewardAmount = totalAmount * sellerRewardPercentage;

  buyerRewardAmount *= 10000; // Multiply by 10000 to handle decimal errors and then STRATS conversion.
  sellerRewardAmount *= 10000; // Multiply by 10000 to handle decimal errors and then STRATS conversion.

  // Round the reward amounts to ensure they're integers
  buyerRewardAmount = Math.round(buyerRewardAmount);
  sellerRewardAmount = Math.round(sellerRewardAmount);

  console.log("Buyer reward amount:", buyerRewardAmount);
  console.log("Seller reward amount:", sellerRewardAmount);

  // Create transaction payload and send it to the purchaser
  let purchaserBody, sellerBody;

  try {
    const purchaserResponse = await createTransactionPayload(
      token,
      purchaser,
      buyerRewardAmount
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

    purchaserBody = await purchaserResponse.json();
    console.log("Purchaser transfer response body:", purchaserBody);
  } catch (error) {
    console.error("Error processing purchaser transaction:", error.message);
    throw error; // Propagate the error to stop further processing if the purchaser transaction fails
  }

  // Create transaction payload and send it to the seller
  try {
    const sellerResponse = await createTransactionPayload(
      token,
      seller,
      sellerRewardAmount
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

    sellerBody = await sellerResponse.json();
    console.log("Seller transfer response body:", sellerBody);
  } catch (error) {
    console.error("Error processing seller transaction:", error.message);
    throw error; // Propagate the error if the seller transaction fails
  }
}

module.exports = { handleOrderRewards };
