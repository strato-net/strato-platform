const { createToken } = require("../token/createToken");
const { createPoolFactory } = require("../pool/createPoolFactory");
const { createPool } = require("../pool/createPool");
const { getEnvVar } = require("../../util");

async function deployTokensAndPool() {
  try {
    // Get environment variables for Token A
    const TOKEN_A_NAME = getEnvVar("TOKEN_A_NAME");
    const TOKEN_A_SYMBOL = getEnvVar("TOKEN_A_SYMBOL");
    const TOKEN_A_DECIMALS = getEnvVar("TOKEN_A_DECIMALS");
    const TOKEN_A_INITIAL_SUPPLY = getEnvVar("TOKEN_A_INITIAL_SUPPLY");
    const TOKEN_A_DESCRIPTION = getEnvVar("TOKEN_A_DESCRIPTION");
    const TOKEN_A_IMAGES = JSON.parse(getEnvVar("TOKEN_A_IMAGES"));
    const TOKEN_A_FILES = JSON.parse(getEnvVar("TOKEN_A_FILES"));
    const TOKEN_A_FILE_NAMES = JSON.parse(getEnvVar("TOKEN_A_FILE_NAMES"));
    // Get environment variables for Token B
    const TOKEN_B_NAME = getEnvVar("TOKEN_B_NAME");
    const TOKEN_B_SYMBOL = getEnvVar("TOKEN_B_SYMBOL");
    const TOKEN_B_DECIMALS = getEnvVar("TOKEN_B_DECIMALS");
    const TOKEN_B_INITIAL_SUPPLY = getEnvVar("TOKEN_B_INITIAL_SUPPLY");
    const TOKEN_B_DESCRIPTION = getEnvVar("TOKEN_B_DESCRIPTION");
    const TOKEN_B_IMAGES = JSON.parse(getEnvVar("TOKEN_B_IMAGES"));
    const TOKEN_B_FILES = JSON.parse(getEnvVar("TOKEN_B_FILES"));
    const TOKEN_B_FILE_NAMES = JSON.parse(getEnvVar("TOKEN_B_FILE_NAMES"));

    console.log("Creating Token A...");
    const tokenAAddress = await createToken(
      TOKEN_A_NAME,
      TOKEN_A_DESCRIPTION,
      TOKEN_A_IMAGES,
      TOKEN_A_FILES,
      TOKEN_A_FILE_NAMES,
      TOKEN_A_SYMBOL,
      TOKEN_A_INITIAL_SUPPLY,
      TOKEN_A_DECIMALS
    );
    console.log("Token A created at address:", tokenAAddress);
    console.log("Creating Token B...");
    const tokenBAddress = await createToken(
      TOKEN_B_NAME,
      TOKEN_B_DESCRIPTION,
      TOKEN_B_IMAGES,
      TOKEN_B_FILES,
      TOKEN_B_FILE_NAMES,
      TOKEN_B_SYMBOL,
      TOKEN_B_INITIAL_SUPPLY,
      TOKEN_B_DECIMALS
    );
    console.log("Token B created at address:", tokenBAddress);

    console.log("Creating Pool Factory Contract...");
    const poolFactoryAddress = await createPoolFactory();
    console.log(
      "Pool Factory Contract created at address:",
      poolFactoryAddress
    );

    console.log("Creating Pool for Token A and Token B...");
    const poolAddress = await createPool(
      tokenAAddress[0],
      tokenBAddress[0],
      poolFactoryAddress[0]
    );
    console.log("Pool created at address:", poolAddress);

    return {
      tokenAAddress,
      tokenBAddress,
      poolFactoryAddress,
      poolAddress,
    };
  } catch (error) {
    console.error("Error in deployTokensAndPool:", error);
    throw error;
  }
}

async function main() {
  try {
    const result = await deployTokensAndPool();
    console.log(result);
  } catch (error) {
    console.error("Fatal error in deployment:", error);
    process.exit(1);
  }
}

main();
