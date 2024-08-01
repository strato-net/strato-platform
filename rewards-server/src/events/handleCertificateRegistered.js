const { createTransactionPayload } = require("../helper/transferSTRATS");
const {
  NODE,
  prodMarketplaceUrl,
  testnetMarketplaceUrl,
} = require("../config");
const { authenticateGoogleSheet, getSTRATSAmount  } = require("../helper/googleSheet");

async function getRewardAmount() {
  const { googleSheets, spreadsheetId } = await authenticateGoogleSheet();
  return await getSTRATSAmount(googleSheets, spreadsheetId, "CertificateRegistered");
}

async function handleCertificateRegistered(event, token) {
  try {
    const { eventTxHash } = event;
    const targetCertificateEntry = event.eventEvent.eventArgs.find(
      (arg) => arg[0] === "certificate"
    );
    const targetCertificateString = targetCertificateEntry
      ? targetCertificateEntry[1]
      : null;

    if (!targetCertificateString) {
      console.error("No certificate string found in the event.");
      return;
    }

    // Fetch certificates based on transaction hash
    const queryResponse = await fetch(
      `https://${
        NODE === "prod" ? prodMarketplaceUrl : testnetMarketplaceUrl
      }/cirrus/search/Certificate?transaction_hash=eq.${eventTxHash}`,
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

    if (!queryResponse.ok) {
      const errorText = await queryResponse.text();
      console.error(
        `Error: ${queryResponse.status} ${queryResponse.statusText}`
      );
      console.error(`Response body: ${errorText}`);
      throw new Error(
        `Request failed with status ${queryResponse.status}: ${queryResponse.statusText}`
      );
    }

    const queryBody = await queryResponse.json();

    const matchedObject = queryBody.find((obj) =>
      obj.certificateString.includes(targetCertificateString)
    );

    if (!matchedObject) {
      console.log("No match found.");
      return;
    }

    const rewardAmount = await getRewardAmount()
    
      
  if (!rewardAmount || rewardAmount <= 0) {
    console.error("Failed to get reward amount from Google Sheet");
    return;
  }
    
    // Create transaction payload
    const response = await createTransactionPayload(
      token,
      matchedObject.userAddress,
      rewardAmount * 100
    );

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`Error: ${response.status} ${response.statusText}`);
      console.error(`Response body: ${errorText}`);
      throw new Error(
        `Request failed with status ${response.status}: ${response.statusText}`
      );
    }

    const body = await response.json();
    console.log("Transfer STRATS response:", body);
  } catch (error) {
    console.error("Error handling CertificateRegistered event:", error);
  }
}

module.exports = { handleCertificateRegistered };
