const { google } = require("googleapis");
const { googleSheetId, googleCredentials } = require("../config");

/**
 * Authenticate with Google Sheets and fetch reward amounts.
 * @param {Array<string>} eventKeys - Array of event keys to fetch rewards for.
 * @returns {Promise<object>} Object containing reward amounts for the specified event keys.
 */
async function getRewards(eventKeys) {
  const auth = new google.auth.GoogleAuth({
    keyFile: googleCredentials,
    scopes: "https://www.googleapis.com/auth/spreadsheets",
  });
  const client = await auth.getClient();
  const googleSheets = google.sheets({ version: "v4", auth: client });
  const spreadsheetId = googleSheetId;

  const range = "Sheet1!A1:G"; // Adjust the range if necessary to match the columns
  try {
    const response = await googleSheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    const rows = response.data.values;

    if (!rows || rows.length === 0) {
      console.log("No data found.");
      return {};
    }

    const headerRow = rows[0];
    const dataRows = rows.slice(1);

    const eventIndex = headerRow.indexOf('Event');
    const amountIndex = headerRow.indexOf('Amount');

    if (eventIndex === -1 || amountIndex === -1) {
      console.error("Required columns (Event, Amount) not found in the sheet.");
      return {};
    }

    const amounts = {};
    for (const row of dataRows) {
      const event = row[eventIndex];
      const amount = row[amountIndex];
      if (eventKeys.includes(event)) {
        amounts[event] = amount;
      }
    }

    return amounts;
  } catch (error) {
    console.error("Error fetching entries:", error);
    throw error;
  }
}

module.exports = {
  getRewards,
};
