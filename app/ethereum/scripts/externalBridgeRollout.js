const path = require("node:path");
const dotenv = require("dotenv");

dotenv.config({ quiet: true });
dotenv.config({
  path: path.resolve(__dirname, "../../contracts/.env"),
  quiet: true,
  override: false,
});

const flow = require("./lib/bridgeDeploymentFlow");
const runtime = require("./lib/rolloutRuntime");
const governance = require("./lib/rolloutGovernance");
const eabInspection = require("./lib/rolloutEabInspection");
const nativeInspection = require("./lib/rolloutNativeInspection");
const handoff = require("./lib/rolloutHandoff");
const output = require("./lib/rolloutOutput");
const { redact } = runtime;

async function main(argv = process.argv.slice(2)) {
  const result = await flow.main(argv);
  if (result !== undefined) console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().then(() => process.exit(0)).catch((error) => {
    console.error(redact(error.message));
    process.exit(1);
  });
}

module.exports = {
  ...runtime,
  ...governance,
  ...eabInspection,
  ...nativeInspection,
  ...handoff,
  ...output,
  ...flow,
  main,
};
