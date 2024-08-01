const { google } = require("googleapis");
const { googleSheetId, googleCredentials } = require("../config");

/**
 * Authenticate with Google Sheets.
 * @returns {Promise<{googleSheets: object, spreadsheetId: string}>} Google Sheets client and spreadsheet ID.
 */
async function authenticateGoogleSheet() {
  const auth = new google.auth.GoogleAuth({
    keyFile: googleCredentials,
    scopes: "https://www.googleapis.com/auth/spreadsheets",
  });
  const client = await auth.getClient();
  const googleSheets = google.sheets({ version: "v4", auth: client });
  return { googleSheets, spreadsheetId: googleSheetId };
}

/**
 * Get the STRATS amount for a given event from Google Sheets.
 * @param {object} googleSheets - Google Sheets client.
 * @param {string} spreadsheetId - ID of the spreadsheet.
 * @param {string} event - Event name to find the associated amount.
 * @returns {Promise<string|null>} The amount associated with the event, or null if not found.
 */
async function getSTRATSAmount(googleSheets, spreadsheetId, event) {
  const range = "Sheet1!A1:Z"; // Adjust the range to cover all potential columns
  try {
    const response = await googleSheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });
    const rows = response.data.values;

    if (!rows || rows.length === 0) {
      console.log("No data found.");
      return null;
    }

    // Find the column index for "Amount"
    const headerRow = rows[0];
    const amountColumnIndex = headerRow.findIndex((header) => header === "Amount");

    if (amountColumnIndex === -1) {
      console.log("'Amount' column not found.");
      return null;
    }

    // Find the row for the specified event
    for (const row of rows.slice(1)) { // Start from the second row to skip the header
      if (row[0] === event) {
        return row[amountColumnIndex]; // Return the amount from the "Amount" column
      }
    }

    console.log("Event not found.");
    return null;
  } catch (error) {
    console.error("Error fetching entries:", error);
    throw error;
  }
}



module.exports = {
  authenticateGoogleSheet,
  getSTRATSAmount,
};
