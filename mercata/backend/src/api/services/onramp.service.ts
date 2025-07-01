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
        {
          ...p.value,
          providerAddress: p.key, // Use the key as the provider address
          // Override corrupted data if needed
          ...(p.value.name === "0000000000000000000000000000000000000000" ? {
            name: "Local Provider",
            endpoint: "http://localhost:3002/checkout"
          } : {})
        }
      ])
    );

    // DEBUG: Log the raw data structure
    console.log("=== DEBUG: OnRamp Data Structure ===");
    console.log("Listings:", JSON.stringify(listings, null, 2));
    console.log("Payment Providers:", JSON.stringify(paymentProviders, null, 2));
    console.log("Provider Map:", JSON.stringify(providerMap, null, 2));

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
      const { key: id, value: info } = listing; // Fixed: use 'value' instead of 'ListingInfo'

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
    
    // Validate listing - find by token address, not listing ID
    const listing = ramp.listings.find((l: any) => String(l.ListingInfo?.token) === String(token));
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

    // Process payment
    console.log("STRIPE: Making request to:", paymentProvider.endpoint);
    console.log("STRIPE: Payload:", { token, buyerAddress, amount, baseUrl });
    
    try {
      const { data } = await axios.post(paymentProvider.endpoint, {
        token,
        buyerAddress,
        amount,
        baseUrl,
      });

      console.log("STRIPE: Response:", data);

      if (!data?.sessionId || !data?.url) {
        throw new Error("Invalid provider session response");
      }

      return {
        sessionId: data.sessionId,
        url: data.url,
      };
    } catch (stripeError) {
      console.error("STRIPE: Error making request:", stripeError.response?.data || stripeError.message);
      throw stripeError;
    }
  } catch (error) {
    console.error("BUY: General error:", error);
    throw new Error("Failed to process payment. Please try again.");
  }
}

export async function handleStripeWebhook(
  body: any,
  signature: string
): Promise<void> {
  // TODO: Verify webhook signature with Stripe
  // const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  // const event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET);
  
  try {
    // For now, parse the webhook payload directly
    const event = JSON.parse(body);
    console.log(" ---------------- ENTERED HANDLE STRIPE WEBHOOK ----------------");
    
    if (event.type === 'checkout.session.completed') {

      console.log("---------SUCCESSFUL PAYMENT---------");

      const session = event.data.object;
      const { token, buyerAddress, amount, tokenAmount } = session.metadata || {};
      
      if (!token || !buyerAddress || !tokenAmount) {
        console.error("Missing required metadata in Stripe session");
        return;
      }

      console.log(`Processing payment for token ${token}, buyer ${buyerAddress}, amount ${tokenAmount}`);

      // Get service token for API calls
      const accessToken = process.env.SERVICE_TOKEN || "";

      // Build transaction to fulfill listing AND mint voucher tokens
      const tx = buildFunctionTx([
        {
          contractName: extractContractName(OnRamp),
          contractAddress,
          method: "fulfillListing",
          args: { token, buyer: buyerAddress, amount: tokenAmount },
        },
        {
          contractName: "Voucher",
          contractAddress: "A96c02a13b558fbcf923af1d586967cf7f55c753",
          method: "mint",
          args: { 
            to: buyerAddress,
            amount: (10n ** 18n).toString() // 10^18 units
          },
        }
      ]);

      const { status, hash } = await postAndWaitForTx(accessToken, () =>
        strato.post(accessToken, StratoPaths.transactionParallel, tx)
      );

      if (status === "Success") {
        console.log(`PAYMENT SUCCESSFUL - Order ${token} confirmed on-chain: ${hash}`);
      } else {
        console.error(`Payment processing failed (${status}): ${hash}`);
      }
    }
  } catch (error) {
    console.error("Error processing Stripe webhook:", error);
    throw error;
  }
}