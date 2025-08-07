import { useState } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { Loader2, Info, Plus } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface AddPaymentProviderFormValues {
  name: string;
  endpoint: string;
  providerAddress: string;
}

const AddPaymentProviderForm = () => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const form = useForm<AddPaymentProviderFormValues>({
    defaultValues: {
      name: "",
      endpoint: "",
      providerAddress: "",
    },
  });

  const onSubmit = async (data: AddPaymentProviderFormValues) => {
    setLoading(true);
    try {
      // TODO: Implement payment provider creation API call
      console.log("Adding payment provider:", data);
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      toast({
        title: "Success",
        description: "Payment provider added successfully!",
      });
      
      form.reset();
    } catch (error) {
      console.error("Error adding payment provider:", error);
      toast({
        title: "Error",
        description: "Failed to add payment provider. Please try again.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription>
          Add a new payment provider to enable fiat-to-crypto purchases. 
          The provider address should be a valid blockchain address that can process payments.
        </AlertDescription>
      </Alert>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <FormField
              control={form.control}
              name="name"
              rules={{
                required: "Provider name is required",
                minLength: {
                  value: 2,
                  message: "Provider name must be at least 2 characters"
                }
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Provider Name</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., Stripe, PayPal, Coinbase"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    A friendly name for the payment provider
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="providerAddress"
              rules={{
                required: "Provider address is required",
                pattern: {
                  value: /^0x[a-fA-F0-9]{40}$/,
                  message: "Please enter a valid Ethereum address"
                }
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Provider Address</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="0x..."
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    The blockchain address of the payment provider
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />
          </div>

          <FormField
            control={form.control}
            name="endpoint"
            rules={{
              required: "Endpoint URL is required",
              pattern: {
                value: /^https?:\/\/.+/,
                message: "Please enter a valid URL starting with http:// or https://"
              }
            }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>API Endpoint</FormLabel>
                <FormControl>
                  <Input
                    placeholder="https://api.provider.com/payments"
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  The API endpoint URL for processing payments with this provider
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <div className="flex justify-end">
            <Button type="submit" disabled={loading} className="min-w-[120px]">
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  Add Provider
                </>
              )}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
};

export default AddPaymentProviderForm;