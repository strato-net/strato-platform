/**
 * Permit a token + route on a freshly deployed DepositRouter.
 *
 * deployProofBridge.js deploys the router but configures NOTHING about which
 * tokens it accepts, so a new router rejects every deposit with NotPermitted
 * until this runs. Re-pointing a chain at a new router without this silently
 * breaks the inbound path.
 *
 *   ROUTER=0x... STRATO_TOKEN=0x... [TOKEN=0x0] \
 *     npx hardhat run scripts/configureDepositRouter.js --network baseSepolia
 */
const { ethers } = require("hardhat");

async function main() {
  const router = process.env.ROUTER;
  const stratoToken = process.env.STRATO_TOKEN;
  const token = process.env.TOKEN || ethers.ZeroAddress; // address(0) = native ETH
  if (!router || !stratoToken) throw new Error("ROUTER and STRATO_TOKEN are required");

  const [signer] = await ethers.getSigners();
  const c = new ethers.Contract(router, [
    "function owner() view returns (address)",
    "function tokenConfig(address) view returns (uint96 min, bool isPermitted)",
    "function routePermitted(address,address) view returns (bool)",
    "function setPermitted(address token, bool isPermitted)",
    "function setRoutePermitted(address token, address targetStratoToken, bool isPermitted)",
  ], signer);

  const owner = await c.owner();
  if (owner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error(`router is owned by ${owner}, not ${signer.address} -- these setters are onlyOwner`);
  }

  const before = await c.tokenConfig(token);
  if (!before.isPermitted) {
    console.log(`setPermitted(${token}, true)`);
    await (await c.setPermitted(token, true)).wait(1);
  } else console.log("token already permitted");

  if (!(await c.routePermitted(token, stratoToken))) {
    console.log(`setRoutePermitted(${token}, ${stratoToken}, true)`);
    await (await c.setRoutePermitted(token, stratoToken, true)).wait(1);
  } else console.log("route already permitted");

  const after = await c.tokenConfig(token);
  console.log(`\nfinal: permitted=${after.isPermitted} min=${ethers.formatEther(after.min)} route=${await c.routePermitted(token, stratoToken)}`);
}
main().catch((e) => { console.error("FAILED:", e.message || e); process.exit(1); });
