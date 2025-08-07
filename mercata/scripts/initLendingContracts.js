// Wrapper to run the post-deployment lending initialization quickly
// Usage: node scripts/initLendingContracts.js
// Reads all required addresses from environment variables (see underlying script).

require("dotenv").config();

(async () => {
  try {
    // Delegates to the canonical initializer located in contracts/deploy/…
    const init = require("../contracts/deploy/deployment-scripts/postRestart/initLendingContracts");
    await init();
    console.log("Lending protocol initialization completed without error ✅");
  } catch (err) {
    console.error("Initialization script failed:", err.message || err);
    process.exit(1);
  }
})();

// (collateral defaults & fallback price logic removed – handled in canonical script)