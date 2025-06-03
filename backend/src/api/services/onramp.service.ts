import { strato, bloc, cirrus } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";
import { StratoPaths, constants } from "../../config/constants";
import { baseUrl } from "../../config/config";
import { approveAsset } from "../helpers/tokens.helper";
import { isValidUrl, calculateTotalAmount } from "../helpers/onramp.helper";
import axios from "axios";

const contractAddress = constants.onRamp!;
const { OnRamp } = constants;

// Get all tokens with optional filtering
export const get = async (accessToken: string) => {
  try {
    const response = await bloc.get(
      accessToken,
      StratoPaths.state.replace(":contractAddress", contractAddress)
    );

    if (!response?.data) {
      throw new Error("Empty response from bloc for OnRamp state");
    }

    const ramp: {
      priceOracle: string;
      listings: Record<string, { token: string }>;
      [key: string]: any;
    } = response.data;

    const { priceOracle } = ramp;
    const listings = ramp.listings || {};
    const approvedTokens = ramp.approvedTokens || {};
    const listingProviders = ramp.listingProviders || {};
    const paymentProviders = ramp.paymentProviders || {};

    const oracleResponse = await bloc.get(
      accessToken,
      StratoPaths.state.replace(":contractAddress", priceOracle)
    );

    const oracleValues = oracleResponse?.data?.prices || {};

    const approvedAddresses = Object.keys(approvedTokens);

    let tokenInfoMap: Record<string, { name: string; symbol: string }> = {};
    try {
      const tokenResponse = await cirrus.get(
        accessToken,
        "BlockApps-Mercata-ERC20",
        {
          params: {
            address: "in.(" + approvedAddresses.join(",") + ")",
            select: "address,_name,_symbol",
          },
        }
      );

      tokenInfoMap = tokenResponse.data.reduce(
        (map: Record<string, { name: string; symbol: string }>, t: any) => {
          map[t.address] = {
            name: t._name,
            symbol: t._symbol,
          };
          return map;
        },
        {}
      );
    } catch (error) {
      console.error("Error fetching token info:", error);
    }

    // Build enhanced listings
    const enhancedListings: Record<string, any> = {};
    for (const [id, listing] of Object.entries(listings)) {
      const providerAddresses = listingProviders[id]
        ? Object.keys(listingProviders[id]).filter(
            (key) => listingProviders[id][key] === true
          )
        : [];

      const providers = providerAddresses
        .map((address) => {
          const provider = paymentProviders.find(
            (p: { providerAddress: string }) => p.providerAddress === address
          );
          return provider;
        })
        .filter((name) => name !== null);

      enhancedListings[id] = {
        ...listing,
        tokenName: tokenInfoMap[listing.token]?.name || null,
        tokenSymbol: tokenInfoMap[listing.token]?.symbol || null,
        tokenOracleValue: oracleValues[listing.token] || null,
        paymentProviders: providers || [],
      };
    }

    // Build enhanced approvedTokens
    const enhancedApprovedTokens: Record<
      string,
      { tokenName: string; tokenSymbol: string }
    > = {};
    for (const [addr, _] of Object.entries(approvedTokens)) {
      enhancedApprovedTokens[addr] = {
        tokenName: tokenInfoMap[addr]?.name || "",
        tokenSymbol: tokenInfoMap[addr]?.symbol || "",
      };
    }

    return {
      ...ramp,
      listings: enhancedListings,
      approvedTokens: enhancedApprovedTokens,
    };
  } catch (error) {
    console.error("Error fetching lending pools:", error);
    throw error;
  }
};

export const sell = async (
  accessToken: string,
  body: {
    token: string;
    amount: string;
    marginBps: string;
    providerAddresses: string[];
  }
) => {
  try {
    const { token, amount, marginBps, providerAddresses } = body;
    await approveAsset(accessToken, token || "", contractAddress, amount || "");
    const tx = buildFunctionTx({
      contractName: extractContractName(OnRamp),
      contractAddress,
      method: "createListing",
      args: {
        token,
        amount,
        marginBps,
        providerAddresses,
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
    console.error("Error selling tokens:", error);
    throw error;
  }
};

export async function lock(
  accessToken: string,
  buyerAddress: string,
  {
    listingId,
    amount,
    paymentProviderAddress,
  }: { listingId: string; amount: string; paymentProviderAddress: string }
): Promise<{ sessionId: string; url: string }> {
  // 1. Lock tokens on the blockchain
  const lockTx = buildFunctionTx({
    contractName: extractContractName(OnRamp),
    contractAddress,
    method: "lockTokens",
    args: { listingId, amount },
  });

  const { status, hash } = await postAndWaitForTx(accessToken, () =>
    strato.post(accessToken, StratoPaths.transactionParallel, lockTx)
  );

  if (status !== "Success") {
    throw new Error(
      `Blockchain transaction failed: Status=${status}, TxHash=${hash}`
    );
  }

  // 2. Get contract state
  let listings, oracle, paymentProvider, endpoint;
  try {
    const stateResp = await bloc.get(
      accessToken,
      StratoPaths.state.replace(":contractAddress", contractAddress)
    );

    const ramp = stateResp?.data;
    if (!ramp?.listings?.[listingId]) {
      throw new Error(`Order ${listingId} not found`);
    }

    listings = ramp.listings;
    oracle = ramp.oracle;
    paymentProvider = ramp.paymentProviders.find(
      (provider: { providerAddress: string }) =>
        provider.providerAddress === paymentProviderAddress
    );

    if (!paymentProvider) {
      throw new Error("Payment provider not found");
    }

    endpoint = paymentProvider.endpoint;
  } catch (error) {
    console.error("Error fetching contract state:", error);
    return {
      sessionId: "",
      url: `${baseUrl}/onramp/cancel?listingId=${listingId}`,
    };
  }

  // 3. Handle payment
  try {
    if (!isValidUrl(endpoint)) {
      const listing = listings[listingId];
      const price = oracle?.prices?.[listing.token];
      if (!price) throw new Error(`Price not found for token ${listing.token}`);

      const totalAmount = calculateTotalAmount(
        amount,
        price,
        listing.marginBps
      );
      const providerTx = buildFunctionTx({
        contractName: "",
        contractAddress:
          paymentProvider.providerAddress ?? paymentProviderAddress,
        method: endpoint,
        args: {
          listingId,
          amount: totalAmount,
          buyer: buyerAddress,
        },
      });

      const providerResult = await postAndWaitForTx(accessToken, () =>
        strato.post(accessToken, StratoPaths.transactionParallel, providerTx)
      );

      if (providerResult.status !== "Success") {
        throw new Error(
          `Payment transaction failed: Status=${providerResult.status}, TxHash=${providerResult.hash}`
        );
      }

      return {
        sessionId: providerResult.hash,
        url: "/",
      };
    } else {
      const { data } = await axios.post(endpoint, {
        listingId,
        buyerAddress,
        baseUrl,
      });

      if (!data?.sessionId || !data?.url) {
        console.error("Provider checkout failed:", data);
        throw new Error("Invalid provider session response");
      }

      return { sessionId: data.sessionId, url: data.url };
    }
  } catch (error) {
    console.error("Payment handling failed:", error);
    return {
      sessionId: "",
      url: `${baseUrl}/onramp/cancel?listingId=${listingId}`,
    };
  }
}

export async function unlockTokens(
  accessToken: string,
  listingId: string
): Promise<{ status: string; hash: string }> {
  try {
    const tx = buildFunctionTx({
      contractName: extractContractName(OnRamp),
      contractAddress,
      method: "unlockTokens",
      args: { listingId },
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
}
