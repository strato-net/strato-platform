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
 * Check for duplicates in Google Sheet.
 * @param {object} googleSheets - Google Sheets client.
 * @param {string} spreadsheetId - ID of the spreadsheet.
 * @param {string|number} id - ID to check for duplicates.
 * @returns {Promise<boolean>} True if duplicate exists, false otherwise.
 */
async function getSTRATSAmount(googleSheets, spreadsheetId, event) {
  const range = "Sheet1!A2:C"; // Adjust the range if necessary to match the columns
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

    for (const row of rows) {
      if (row[0] === event) {
        return row[2]; // Assuming Amount is in the 3rd column (index 2)
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
