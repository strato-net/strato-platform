const path = require("path");
const { spawnSync } = require("child_process");

function parseStep(argv) {
  let step = "all";
  const passthrough = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg !== "--step") {
      passthrough.push(arg);
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      throw new Error("Missing value for --step");
    }
    step = String(next).trim().toLowerCase();
    i++;
  }

  if (!["all", "upgrade", "setters"].includes(step)) {
    throw new Error(`Invalid --step "${step}". Use all|upgrade|setters.`);
  }

  return { step, passthrough };
}

function run(scriptName, args) {
  const scriptPath = path.resolve(__dirname, scriptName);
  const child = spawnSync(process.execPath, [scriptPath, ...args], {
    stdio: "inherit",
    env: process.env,
  });
  if (child.error) throw child.error;
  const code = Number.isInteger(child.status) ? child.status : 1;
  if (code !== 0) {
    throw new Error(`${scriptName} exited with code ${code}`);
  }
}

function main() {
  const { step, passthrough } = parseStep(process.argv.slice(2));

  if (step === "upgrade" || step === "all") {
    run("depositRouterUpgradePropose.js", passthrough);
  }
  if (step === "setters" || step === "all") {
    run("depositRouterQueueSetters.js", passthrough);
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error("depositRouterOps failed:", error.message);
    process.exit(1);
  }
}

