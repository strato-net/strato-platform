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
const { OnRamp, onRampSelectFields, Token } = constants;

// Get all tokens with optional filtering
export const get = async (accessToken: string) => {
  try {
    // Fetch OnRamp data
    const { data: onRampData } = await cirrus.get(accessToken, `/${OnRamp}`, {
      params: {
        select: onRampSelectFields.join(","),
        "listings.value.id": "gt.0",
        address: `eq.${contractAddress}`,
      },
    });

    if (!onRampData?.length) throw new Error("OnRamp data not found");

    const onRamp = onRampData[0];
    const {
      listings,
      paymentProviders,
      approvedTokens,
      listingProviders,
      priceOracle,
    } = onRamp;

    // Build token price map
    const prices = Object.fromEntries(
      (priceOracle?.prices || [])
        .filter((p: any) => p.token)
        .map((p: any) => [p.token, p])
    );

    // Extract approved token addresses
    const approvedAddresses = approvedTokens
      .filter((t: any) => t.value)
      .map((t: any) => t.token);

    // Fetch token metadata
    let tokenInfoMap: Record<string, { _name: string; _symbol: string }> = {};
    try {
      const { data: tokenData } = await cirrus.get(accessToken, `/${Token}`, {
        params: {
          address: `in.(${approvedAddresses.join(",")})`,
          select: "address,_name,_symbol",
        },
      });

      tokenInfoMap = Object.fromEntries(
        tokenData.map((t: any) => [
          t.address,
          { _name: t._name, _symbol: t._symbol },
        ])
      );
    } catch (err) {
      console.error("Error fetching token info:", err);
    }

    // Normalize payment providers into map
    const paymentProviderMap = Object.fromEntries(
      paymentProviders
        .flatMap((p: any) =>
          Array.isArray(p.PaymentProviderInfo)
            ? p.PaymentProviderInfo
            : [p.PaymentProviderInfo]
        )
        .filter((info: any) => info.providerAddress)
        .map((info: any) => [info.providerAddress, info])
    );

    // Enhance listings
    const enhancedListings = listings.map((listing: any) => {
      const { key: id, ListingInfo: info } = listing;

      const providers = listingProviders
        .filter((p: any) => p.value)
        .map((p: any) => paymentProviderMap[p.paymentProvider])
        .filter(Boolean);

      const tokenMeta = tokenInfoMap[info.token] || {
        _name: null,
        _symbol: null,
      };

      return {
        key: id,
        ...info,
        _name: tokenMeta._name,
        _symbol: tokenMeta._symbol,
        tokenOracleValue: prices[info.token] || null,
        paymentProviders: providers,
      };
    });

    // Enrich approvedTokens in-place
    approvedTokens.forEach((entry: any) => {
      const meta = tokenInfoMap[entry.token];
      entry._name = meta?._name || null;
      entry._symbol = meta?._symbol || null;
    });

    return {
      ...onRamp,
      listings: enhancedListings,
      approvedTokens,
      priceOracle: undefined,
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

  // 2. Get updated onRamp state (enriched listings)
  let listings: any[], paymentProviders: any[];

  try {
    const ramp = await get(accessToken);

    listings = ramp.listings;
    paymentProviders = (ramp.paymentProviders || []).filter(
      (p: any) =>
        typeof p.PaymentProviderInfo === "object" &&
        !Array.isArray(p.PaymentProviderInfo)
    );

    const paymentProviderInfo = paymentProviders
      .map((p: any) => p.PaymentProviderInfo)
      .find((info: any) => info.providerAddress === paymentProviderAddress);

    if (!paymentProviderInfo) {
      throw new Error("Payment provider not found");
    }

    const listing = listings.find((l) => String(l.key) === String(listingId));
    if (!listing) {
      throw new Error(`Listing ${listingId} not found`);
    }

    const { tokenOracleValue, marginBps } = listing;
    const endpoint = paymentProviderInfo.endpoint;

    // 3. Execute payment
    if (!isValidUrl(endpoint)) {
      if (!tokenOracleValue?.price) {
        throw new Error(`Missing tokenOracleValue for listing ${listingId}`);
      }

      const totalAmount = calculateTotalAmount(
        amount,
        tokenOracleValue.price,
        marginBps
      );

      const providerTx = buildFunctionTx({
        contractName: "",
        contractAddress: paymentProviderInfo.providerAddress,
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
    await unlockTokens(accessToken, listingId).catch((unlockError) => {
      console.error(
        "Failed to unlock tokens after payment error:",
        unlockError
      );
    });
    throw new Error(`Payment processing failed`);
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
