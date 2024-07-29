const { createTransactionPayload } = require("../helper/transferSTRATS");

async function handleCertificateRegistered(event, token) {
  let response = await createTransactionPayload(token);

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Error: ${response.status} ${response.statusText}`);
    console.error(`Response body: ${errorText}`);
    throw new Error(
      `Request failed with status ${response.status}: ${response.statusText}`
    );
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    const errorText = await response.text();
    console.error(`Failed to parse JSON response: ${error.message}`);
    console.error(`Response body: ${errorText}`);
    throw new Error(`Failed to parse JSON response: ${error.message}`);
  }

  console.log("Transfer STRATS response:", body);
}

module.exports = { handleCertificateRegistered };
