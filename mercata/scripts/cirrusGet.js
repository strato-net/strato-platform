const axios = require("axios");
require("dotenv").config();

// USER CONFIG
const TABLE = "/BlockApps-Mercata-LendingRegistry";
const COLS = ["priceOracle"];
const ADDRESS = "0000000000000000000000000000000000001007";

(async () => {
  const ROOT = (process.env.STRATO_NODE_URL || process.env.NODE_URL).replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${process.env.ADMIN_TOKEN}` };

  try {
    const { data } = await axios.get(`${ROOT}/cirrus/search${TABLE}`, {
      headers,
      params: { address: `eq.${ADDRESS}`, select: COLS.join(","), limit: 1 }
    });

    if (data.length > 0) {
      COLS.forEach(col => console.log(`${col}: ${data[0][col]}`));
    } else {
      console.log("No data found");
    }
  } catch (error) {
    console.log(`Error: ${error.message}`);
  }
})();