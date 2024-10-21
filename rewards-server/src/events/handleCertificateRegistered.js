const { createTransactionPayload } = require("../helper/transferSTRATS");
const {
  NODE_ENV,
  prodMarketplaceUrl,
  testnetMarketplaceUrl,
} = require("../config");
const { getRewards } = require("../helper/googleSheet.js");

async function handleCertificateRegistered(event, token) {
  try {
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
        NODE_ENV === "prod" ? prodMarketplaceUrl : testnetMarketplaceUrl
      }/cirrus/search/Certificate?certificateString=eq.${encodeURIComponent(targetCertificateString)}&select=userAddress`,
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
    console.log("Certificate query response:", queryBody);
    if (!queryBody || queryBody.length <= 0) {
      console.error("No certificates found in the marketplace.");
      return;
    }

    // Fetch certificates based on transaction hash
    const userQueryResponse = await fetch(
      `https://${
        NODE_ENV === "prod" ? prodMarketplaceUrl : testnetMarketplaceUrl
      }/cirrus/search/Certificate?userAddress=eq.${encodeURIComponent(queryBody[0].userAddress)}&select=count`,
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
    const userQueryBody = await userQueryResponse.json();
    console.log("User certificate query response:", userQueryBody);
    if (!userQueryBody || userQueryBody.length <= 0) {
      console.error("No certificates found in the marketplace. User address:", queryBody[0].userAddress);
      return;
    }
    if (userQueryBody[0].count > 1) {
      console.error("Multiple certificates found in the marketplace. User address:", queryBody[0].userAddress);
      return;
    }

    const getReward = await getRewards(["handleCertificateRegistered"]);
    const reward = getReward["handleCertificateRegistered"];
    
    if (!reward || reward <= 0) {
      console.error("Failed to get reward amount from Google Sheet");
      return;
    }

    // Create transaction payload
    const transactions = [
      {toAddress: queryBody[0].userAddress, value: reward * 100}
    ];
    const response = await createTransactionPayload(
      token,
      transactions
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
    console.log("New registration reward successful:", body);
  } catch (error) {
    console.error("Error handling CertificateRegistered event:", error);
  }
}

module.exports = { handleCertificateRegistered };
