const axios = require("axios");

async function handleBridgeIn(transaction) {
  const { hash, value } = transaction;
  try {
    // Fetch certificates based on transaction hash
    const queryResponse = await axios.get(
      `https://${baseUrl}/cirrus/search/BlockApps-Mercata-Asset-ETHBridgeHashAdded?hash=eq.${encodeURIComponent(
        hash
      )}`,
      {
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      }
    );
    // waitForAddress TODO

    if (queryResponse.status !== 200) {
      const errorText = await queryResponse.text();
      console.error(
        `Error: ${queryResponse.status} ${queryResponse.statusText}`
      );
      console.error(`Response body: ${errorText}`);
      throw new Error(
        `Request failed with status ${queryResponse.status}: ${queryResponse.statusText}`
      );
    }

    const queryBody = await queryResponse.data;
    console.log("response:", queryBody);
    if (!queryBody || queryBody.length <= 0) {
      console.error("No certificates found in the marketplace.");
      return;
    }

    // Create transaction payload
    const transactions = [
      { toAddress: queryBody[0].recieverCommonName, value }, // try to convert the hex to standart number
    ];
    const response = await createTransactionPayload(token, transactions);

    if (response.status !== 200) {
      const errorText = await response.text();
      console.error(`Error: ${response.status} ${response.statusText}`);
      console.error(`Response body: ${errorText}`);
      throw new Error(
        `Request failed with status ${response.status}: ${response.statusText}`
      );
    }
    console.log("New registration reward successful:", body);
  } catch (error) {
    console.error("Error handling CertificateRegistered event:", error);
  }
}

module.exports = { handleBridgeIn };
