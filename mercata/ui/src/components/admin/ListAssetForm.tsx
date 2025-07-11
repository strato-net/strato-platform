import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Info, ShoppingCart } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { useOnRampContext } from "@/context/OnRampContext";
import { useUserTokens } from "@/context/UserTokensContext";
import { useUser } from "@/context/UserContext";

interface OnRampListingFormValues {
  tokenAddress: string;
  amount: string;
  marginBps: string;
  selectedProviders: string[];
}

const ListAssetForm = () => {
  const [loading, setLoading] = useState(false);
  const [paymentProviders, setPaymentProviders] = useState<any[]>([]);
  const [approvedTokens, setApprovedTokens] = useState<any[]>([]);

  const { toast } = useToast();
  const { userAddress } = useUser();
  const { activeTokens: tokens, loading: tokensLoading, fetchTokens } = useUserTokens();
  const { get, sell } = useOnRampContext();

  const form = useForm<OnRampListingFormValues>({
    defaultValues: {
      tokenAddress: "",
      amount: "",
      marginBps: "",
      selectedProviders: [],
    },
  });

  useEffect(() => {
    fetchData();
    if (userAddress) {
      fetchTokens();
    }
  }, [userAddress]);

  const fetchData = async () => {
    try {
      const data = await get();
      // Extract and flatten payment providers from the onramp data
      if (data.paymentProviders) {
        const flattenedProviders = data.paymentProviders
          .flatMap((p: any) =>
            Array.isArray(p.PaymentProviderInfo)
              ? p.PaymentProviderInfo
              : [p.PaymentProviderInfo]
          )
          .filter((info: any) => info && info.providerAddress);
        setPaymentProviders(flattenedProviders);
      }
      // Set approved tokens from onramp data
      if (data.approvedTokens) {
        setApprovedTokens(data.approvedTokens.filter((token: any) => token.value));
      }
    } catch (error) {
      console.error("Error fetching data:", error);
    }
  };

  const onSubmit = async (data: OnRampListingFormValues) => {
    setLoading(true);
    try {
      if (data.selectedProviders.length === 0) {
        toast({
          title: "Error",
          description: "Please select at least one payment provider.",
          variant: "destructive",
        });
        setLoading(false);
        return;
      }

      const selectedToken = approvedTokens.find((t) => t.token === data.tokenAddress);
    

      const response = await sell({
        token: data.tokenAddress,
        amount: data.amount,
        marginBps: parseInt(data.marginBps).toString(),
        providerAddresses: data.selectedProviders,
      });

      toast({
        title: "Asset Listed Successfully",
        description: `${selectedToken?._symbol} listing created with ${data.amount} tokens available`,
      });

      form.reset();
      fetchData();
    } catch (error: unknown) {
      const apiError = error as { response?: { data?: { message?: string } } };
      toast({
        title: "Error Creating Listing",
        description:
          apiError.response?.data?.message ||
          "Failed to list asset. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const selectedToken =
    approvedTokens && Array.isArray(approvedTokens)
      ? approvedTokens.find((t) => t.token === form.watch("tokenAddress"))
      : null;

  return (
    <div className="space-y-6">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="tokenAddress"
              rules={{ required: "Token selection is required" }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Select Token</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select a token to list" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Array.isArray(approvedTokens) && approvedTokens.length > 0 ? (
                        approvedTokens.map((token) => (
                          <SelectItem key={token.token} value={token.token}>
                            {token._symbol} - {token._name}
                          </SelectItem>
                        ))
                      ) : (
                        <SelectItem value="no-tokens" disabled>
                          No approved tokens available
                        </SelectItem>
                      )}
                    </SelectContent>
                  </Select>
                  <FormDescription>
                    Choose from approved tokens that can be listed for sale
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="amount"
              rules={{
                required: "Amount to sell is required",
                pattern: {
                  value: /^\d+\.?\d*$/,
                  message: "Must be a valid number",
                },
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Amount to List</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="Enter amount of tokens to list"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    The amount of tokens you want to make available for purchase
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="marginBps"
              rules={{
                required: "Margin BPS is required",
                pattern: {
                  value: /^\d+\.?\d*$/,
                  message: "Must be a valid number",
                },
              }}
              render={({ field }) => {
                const bpsValue = field.value ? parseFloat(field.value) : 0;
                const percentageValue = (bpsValue / 100).toFixed(2);
                return (
                  <FormItem>
                    <FormLabel>Margin BPS (Basis Points)</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Input
                          placeholder="Enter margin in basis points"
                          {...field}
                          onChange={(e) => {
                            field.onChange(e);
                          }}
                        />
                        {field.value && (
                          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                            {percentageValue}%
                          </div>
                        )}
                      </div>
                    </FormControl>
                    <FormDescription>
                      Pricing margin over oracle price (e.g. 500 = +5%)
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                );
              }}
            />
          </div>

          {/* Payment Providers Selection */}
          <FormField
            control={form.control}
            name="selectedProviders"
            rules={{
              required: "At least one payment provider must be selected",
            }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Payment Providers</FormLabel>
                <FormDescription>
                  Select which payment providers can process purchases for this
                  listing
                </FormDescription>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                  {paymentProviders.map((provider, index) => (
                    <div key={provider.providerAddress || index} className="flex items-center space-x-2">
                      <Checkbox
                        id={provider.providerAddress || index.toString()}
                        checked={field.value?.includes(provider.providerAddress || index.toString())}
                        onCheckedChange={(checked) => {
                          const currentProviders = field.value || [];
                          const providerId = provider.providerAddress || index.toString();
                          if (checked) {
                            field.onChange([...currentProviders, providerId]);
                          } else {
                            field.onChange(currentProviders.filter(p => p !== providerId));
                          }
                        }}
                      />
                      <label
                        htmlFor={provider.providerAddress || index.toString()}
                        className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
                      >
                        {provider.name || `Provider ${index + 1}`}
                      </label>
                    </div>
                  ))}
                </div>
                <FormMessage />
              </FormItem>
            )}
          />

          {selectedToken && form.watch("amount") && form.watch("marginBps") && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-lg">Listing Preview</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  <div>
                    <p className="text-sm text-gray-500">Token</p>
                    <p className="font-medium">{selectedToken?._symbol}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Amount</p>
                    <p className="font-medium">
                      {form.watch("amount")} {selectedToken?._symbol}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500">Margin</p>
                    <p className="font-medium">
                      +
                      {(
                        parseFloat(form.watch("marginBps") || "0") / 100
                      ).toFixed(2)}
                      %
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Alert>
            <Info className="h-4 w-4" />
            <AlertDescription>
              This form creates an onRamp listing by calling the sell endpoint which creates a listing on the blockchain.
              Make sure you have sufficient tokens and have selected compatible payment providers.
            </AlertDescription>
          </Alert>

          <div className="flex justify-end space-x-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => form.reset()}
              disabled={loading}
            >
              Reset
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="bg-strato-blue hover:bg-strato-blue/90"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Creating Listing...
                </>
              ) : (
                <>
                  <ShoppingCart className="mr-2 h-4 w-4" />
                  List Asset
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};

export default ListAssetForm;