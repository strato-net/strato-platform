const { createTransactionPayload } = require("../helper/transferSTRATS");
const {
  NODE_ENV,
  prodMarketplaceUrl,
  testnetMarketplaceUrl,
} = require("../config");
const { getRewards } = require("../helper/googleSheet.js");
const axios = require("axios");
const { sendEmail } = require("../helper/utils.js");

async function handleCertificateRegistered(event, token) {
  const baseUrl = NODE_ENV === "prod" ? prodMarketplaceUrl : testnetMarketplaceUrl

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
    const queryResponse = await axios.get(
      `https://${baseUrl}/cirrus/search/Certificate?certificateString=eq.${encodeURIComponent(targetCertificateString)}`,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`
        }
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
    if (queryBody.length > 1) {
      console.error("Multiple certificates found in the marketplace.");
      return;
    }

    const getReward = await getRewards(["handleCertificateRegistered"]);
    const reward = getReward["handleCertificateRegistered"];
    
    if (!reward || reward <= 0) {
      console.error("Failed to get reward amount from Google Sheet");
      return;
    }

    // Create transaction payload
    const response = await createTransactionPayload(
      token,
      queryBody[0].userAddress,
      reward * 100 // Multiply by 100 for STRATS conversion
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
    const purchaserName = await getUserName(baseUrl, queryBody[0].userAddress, token)
    sendEmail(baseUrl, 'newRegistration', purchaserName, token );
    
    console.log("New registration reward successful:", body);
  } catch (error) {
    console.error("Error handling CertificateRegistered event:", error);
  }
}

module.exports = { handleCertificateRegistered };
