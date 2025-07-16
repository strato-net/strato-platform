import { strato, cirrus } from "../../utils/mercataApiHelper";
import { buildFunctionTx } from "../../utils/txBuilder";
import { postAndWaitForTx } from "../../utils/txHelper";
import { extractContractName } from "../../utils/utils";
import { StratoPaths, constants } from "../../config/constants";
import { baseUrl } from "../../config/config";
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
      priceOracle,
      paymentProviders,
    } = onRamp;

    // Build token price map
    const prices = Object.fromEntries(
      (priceOracle?.prices || [])
        .filter((p: any) => p.token)
        .map((p: any) => [p.token, p])
    );

    // Build payment provider map
    const providerMap = Object.fromEntries(
      (paymentProviders || []).map((p: any) => [
        p.key,
        p.value
      ])
    );


    // Fetch token metadata
    let tokenInfoMap: Record<string, { _name: string; _symbol: string }> = {};
    try {
      const { data: tokenData } = await cirrus.get(accessToken, `/${Token}`, {
        params: {
          status: "eq.2",
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
      console.log("Error fetching token info:", err);
    }

    // Enhance listings
    const enhancedListings = listings.map((listing: any) => {
      const { key: id, value: info } = listing;

      if (!info) {
        console.error("Warning: Listing has no value data:", listing);
        return null;
      }

      const tokenMeta = tokenInfoMap[info.token] || {
        _name: null,
        _symbol: null,
      };

      // Map provider addresses to their full info
      const providers = (info.providers || [])
        .map((providerAddress: string) => providerMap[providerAddress])
        .filter(Boolean);

      return {
        key: id,
        ListingInfo: {
          ...info,
          _name: tokenMeta._name,
          _symbol: tokenMeta._symbol,
          tokenOracleValue: prices[info.token] || null,
          providers,
        },
      };
    }).filter(Boolean); // Remove null entries

    return {
      ...onRamp,
      listings: enhancedListings,
      approvedTokens: Object.entries(tokenInfoMap).map(([token, info]) => ({
        token,
        _name: info._name,
        _symbol: info._symbol,
      })),
      priceOracle: undefined,
    };
  } catch (error) {
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

    const tx = buildFunctionTx([
      {
        contractName: extractContractName(Token),
        contractAddress: token || "",
        method: "approve",
        args: { spender: contractAddress, value: amount || "" },
      },
      {
        contractName: extractContractName(OnRamp),
        contractAddress,
        method: "createListing",
        args: {
          token,
          amount,
          marginBps,
          providerAddresses,
        },
      }
    ]);

    const { status, hash } = await postAndWaitForTx(accessToken, () =>
      strato.post(accessToken, StratoPaths.transactionParallel, tx)
    );

    return { status, hash };
  } catch (error) {
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
    
    const listing = ramp.listings.find((l: { key: string }) => String(l.key) === String(token));
    if (!listing) {
      throw new Error(`Listing for token ${token} not found. Available tokens: ${ramp.listings.map((l: any) => l.ListingInfo?.token).join(', ')}`);
    }

    // Validate and get payment provider
    const paymentProvider = listing.ListingInfo.providers.find(
      (p: { providerAddress: string }) => p.providerAddress === paymentProviderAddress
    );
    if (!paymentProvider) {
      throw new Error("Payment provider not found");
    }
    
    try {
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
    } catch (stripeError: any) {
      console.error("STRIPE: Error making request:", stripeError.response?.data || stripeError.message);
      throw stripeError;
    }
  } catch (error) {
    console.error("BUY: General error:", error);
    throw new Error("Failed to process payment. Please try again.");
  }
}