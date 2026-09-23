const { ethers } = require("ethers");
const { encodeCall, chunkArray, buildTransactionBuilderBatch } = require("./depositRouterSafeOps");

function buildDepositRouterBatches(rollout) {
  return chunkArray(rollout.depositRouter.updates, 20).map((updates, index) => {
    const transaction = {
      to: rollout.depositRouter.address,
      value: "0",
      data: encodeCall("batchUpdateTokens", [
        updates.map(({ token }) => ethers.getAddress(token)),
        updates.map(({ minDepositAmount }) => minDepositAmount),
        updates.map(({ permitted }) => permitted),
        updates.map(({ targetStratoToken }) => ethers.getAddress(targetStratoToken)),
      ]),
      operation: 0,
    };
    return {
      index: index + 1,
      updates,
      transactionBuilder: buildTransactionBuilderBatch(
        rollout.chainId,
        rollout.depositRouter.safeAddress,
        [transaction],
        {
          name: `EAB all-token DepositRouter batch ${index + 1}`,
          description: `${updates.length} synchronized token route updates`,
        },
      ),
    };
  });
}

function buildDepositRouterControl(rollout, action) {
  if (!["pause", "unpause"].includes(action)) {
    throw new Error(`Unsupported DepositRouter control action: ${action}`);
  }
  return buildTransactionBuilderBatch(
    rollout.chainId,
    rollout.depositRouter.safeAddress,
    [{
      to: rollout.depositRouter.address,
      value: "0",
      data: encodeCall(action, []),
      operation: 0,
    }],
    {
      name: `EAB DepositRouter ${action} (${rollout.chainId})`,
      description: `${action} the new DepositRouter through Safe`,
    },
  );
}

module.exports = { buildDepositRouterBatches, buildDepositRouterControl };
