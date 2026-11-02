const { ethers } = require("ethers");
const {
  encodeExternalAssetDepositRouterCall,
  chunkArray,
  buildTransactionBuilderBatch,
} = require("./depositRouterSafeOps");

function buildDepositRouterBatches(rollout) {
  return chunkArray(rollout.depositRouter.updates, 20).map((updates, index) => {
    const transaction = {
      to: rollout.depositRouter.address,
      value: "0",
      data: encodeExternalAssetDepositRouterCall("batchUpdateTokens", [
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
          name: `EAB all-token ExternalAssetDepositRouter batch ${index + 1}`,
          description: `${updates.length} synchronized token route updates`,
        },
      ),
    };
  });
}

function buildDepositRouterControl(rollout, action) {
  if (!["pause", "unpause"].includes(action)) {
    throw new Error(`Unsupported ExternalAssetDepositRouter control action: ${action}`);
  }
  return buildTransactionBuilderBatch(
    rollout.chainId,
    rollout.depositRouter.safeAddress,
    [{
      to: rollout.depositRouter.address,
      value: "0",
      data: encodeExternalAssetDepositRouterCall(action, []),
      operation: 0,
    }],
    {
      name: `EAB ExternalAssetDepositRouter ${action} (${rollout.chainId})`,
      description: `${action} the new ExternalAssetDepositRouter through Safe`,
    },
  );
}

module.exports = { buildDepositRouterBatches, buildDepositRouterControl };
