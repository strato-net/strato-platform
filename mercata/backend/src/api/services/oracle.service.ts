import { strato } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { StratoPaths, constants } from "../../config/constants";
import { extractContractName } from "../../utils/utils";
import { getPool } from "./lending.service";

const {
  PriceOracle,
} = constants;

export const getPrice = async (
  accessToken: string,
  asset?: string
) => {
  const registry = await getPool(accessToken, undefined, { 
    select: `priceOracle:priceOracle_fkey(address,prices:${PriceOracle}-prices(asset:key,price:value::text))`
  });

  const prices: { asset: string; price: string }[] = registry.priceOracle
    ? registry.priceOracle.prices || []
    : [];

  if (asset) {
    const entry = prices.find(
      (p) => p.asset.toLowerCase() === asset.toLowerCase()
    );
    if (!entry) {
      throw new Error(`Price not found for asset ${asset}`);
    }
    return entry;
  }

  return prices;
};

export const setPrice = async (
  accessToken: string,
  body: Record<string, string | undefined>
) => {
  try {
    const registry = await getPool(accessToken, undefined, {
      select: "priceOracle",
    });
    const priceOracle = registry.priceOracle;
    const tx = buildFunctionTx({
      contractName: extractContractName(PriceOracle),
      contractAddress: priceOracle,
      method: "setAssetPrice",
      args: {
        asset: body.token,
        price: body.price,
      },
    });

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return {
      status,
      hash,
    };
  } catch (error) {
    throw error;
  }
};
