const { createTransactionPayload } = require("../helper/transferSTRATS");
const {
  NODE,
  prodMarketplaceUrl,
  testnetMarketplaceUrl,
} = require("../config");

async function handleFirstOrder(event, token) {
  const purchaser = event.eventEvent.eventArgs.find(
    (arg) => arg[0] === "purchaser"
  )?.[1];

  if (!purchaser) {
    console.error("No purchaser found in event args");
    return;
  }

  // Check if the purchaser has made a first order before
  const queryResponse = await fetch(
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

  const queryBody = await queryResponse.json();
  console.log("First Order queryBody:", queryBody);

  if (queryBody[0].count > 1) {
    console.log("User has already made a first order");
    return;
  }

  // Create a transaction payload with 100 STRATS and send it to eventTxSender
  const response = await createTransactionPayload(token, purchaser, 100);

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

module.exports = { handleFirstOrder };
