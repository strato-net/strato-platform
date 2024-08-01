const { createTransactionPayload } = require("../helper/transferSTRATS");
const {
  NODE,
  prodMarketplaceUrl,
  testnetMarketplaceUrl,
} = require("../config");
const { authenticateGoogleSheet, getSTRATSAmount } = require("../helper/googleSheet.js");

async function getRewardAmount(event) {
  const { googleSheets, spreadsheetId } = await authenticateGoogleSheet();
  return await getSTRATSAmount(googleSheets, spreadsheetId, event);
}

async function handleOrderRewards(event, token) {
  console.log("Handling order event:", event);

  const purchaser = event.eventEvent.eventArgs.find(
    (arg) => arg[0] === "purchaser"
  )?.[1];

  if (!purchaser) {
    console.error("No purchaser found in event args");
    return;
  }

  const orderAmount = parseFloat(
    event.eventEvent.eventArgs.find((arg) => arg[0] === "amount")?.[1] || 0
  );
  const tax = parseFloat(
    event.eventEvent.eventArgs.find((arg) => arg[0] === "tax")?.[1] || 0
  );
  const fee = parseFloat(
    event.eventEvent.eventArgs.find((arg) => arg[0] === "fee")?.[1] || 0
  );
  const totalAmount = orderAmount + tax + fee;

  console.log("totalAmount:", totalAmount, "tax:", tax, "fee:", fee);

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
  console.log("Order queryBody:", queryBody);

  let eventKey = "RegularOrder";

  if (queryBody[0].count === 0) {
    console.log("User's first order");
    eventKey = "FirstOrder";
  }

  const rewardPercentageStr = await getRewardAmount(eventKey);

  if (!rewardPercentageStr) {
    console.error("Failed to get valid reward percentage.");
    return;
  }

  let rewardPercentage;
  if (rewardPercentageStr.includes('%')) {
    rewardPercentage = parseFloat(rewardPercentageStr.replace('%', '')) / 100;
  } else {
    rewardPercentage = parseFloat(rewardPercentageStr);
  }

  if (isNaN(rewardPercentage)) {
    console.error("Failed to get valid reward percentage.");
    return;
  }

  let rewardAmount = totalAmount * rewardPercentage;

  rewardAmount *= 10000; // Multiply by 1000 to handle decimal errors and then strats conversion. 

  // Round the reward amount to ensure it's an integer
  rewardAmount = Math.round(rewardAmount);
  console.log("Reward amount:", rewardAmount);

  // Create a transaction payload and send it to the purchaser
  const response = await createTransactionPayload(token, purchaser, rewardAmount);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Error: ${response.status} ${response.statusText}`);
    console.error(`Response body: ${errorText}`);
    throw new Error(
      `Request failed with status ${response.status}: ${response.statusText}`
    );
  }

  try {
    const body = await response.json();
    console.log("Transfer response body:", body);
  } catch (error) {
    const errorText = await response.text();
    console.error(`Failed to parse JSON response: ${error.message}`);
    console.error(`Response body: ${errorText}`);
    throw new Error(`Failed to parse JSON response: ${error.message}`);
  }
}

module.exports = { handleOrderRewards };
