import { strato, cirrus } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";
import { StratoPaths, constants } from "../../config/constants";
import { baseUrl } from "../../config/config";
import { approveAsset } from "../helpers/tokens.helper";
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
        "listings.value->>id": "gt.0",
        address: `eq.${contractAddress}`,
      },
    });

    if (!onRampData?.length) throw new Error("OnRamp data not found");

    const onRamp = onRampData[0];
    const {
      listings,
      approvedTokens,
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

    // Enhance listings
    const enhancedListings = listings.map((listing: any) => {
      const { key: id, ListingInfo: info } = listing;

      const tokenMeta = tokenInfoMap[info.token] || {
        _name: null,
        _symbol: null,
      };

      return {
        key: id,
        ListingInfo: {
          ...info,
          _name: tokenMeta._name,
          _symbol: tokenMeta._symbol,
          tokenOracleValue: prices[info.token] || null,
        },
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

export async function buy(
  accessToken: string,
  buyerAddress: string,
  {
    token,
    amount,
    paymentProviderAddress,
  }: { token: string; amount: string; paymentProviderAddress: string }
): Promise<{ sessionId: string; url: string }> {
  try {
    const ramp = await get(accessToken);
    
    // Validate listing
    const listing = ramp.listings.find((l: { key: string }) => String(l.key) === String(token));
    if (!listing) {
      throw new Error(`Listing ${token} not found`);
    }

    // Validate and get payment provider
    const paymentProvider = listing.providers.find((p: { provider: string }) => p.provider === paymentProviderAddress);
    if (!paymentProvider) {
      throw new Error("Payment provider not found");
    }

    // Process payment
    const { data } = await axios.post(paymentProvider.endpoint, {
      token,
      buyerAddress,
      amount,
      baseUrl,
    });

    if (!data?.sessionId || !data?.url) {
      throw new Error("Invalid provider session response");
    }

    return {
      sessionId: data.sessionId,
      url: data.url,
    };
  } catch (error) {
    console.error("Payment processing failed:", error);
    throw new Error("Failed to process payment. Please try again.");
  }
}