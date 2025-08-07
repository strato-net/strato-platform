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
import { Loader2, Plus } from "lucide-react";
import { useOnRampContext } from "@/context/OnRampContext";

interface AddPaymentProviderFormValues {
  name: string;
  endpoint: string;
  providerAddress: string;
}

interface AddPaymentProviderFormProps {
  onSuccess?: () => void;
}

const AddPaymentProviderForm = ({ onSuccess }: AddPaymentProviderFormProps) => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { addPaymentProvider } = useOnRampContext();

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
      // Remove 0x prefix if present before sending to backend
      let address = data.providerAddress.toLowerCase();
      if (address.startsWith('0x')) {
        address = address.slice(2);
      }
      
      const result = await addPaymentProvider({
        providerAddress: address,
        name: data.name,
        endpoint: data.endpoint,
      });
      
      // Ensure description is a string
      let successMessage = "Payment provider added successfully!";
      if (result?.message) {
        successMessage = typeof result.message === 'string' 
          ? result.message 
          : JSON.stringify(result.message);
      }
      
      toast({
        title: "Success",
        description: successMessage,
      });
      
      form.reset();
      
      // Call the onSuccess callback after a short delay to ensure blockchain state is updated
      if (onSuccess) {
        setTimeout(() => {
          onSuccess();
        }, 500);
      }
    } catch (error: any) {
      let errorMessage = "Failed to add payment provider. Please try again.";
      if (error?.response?.data) {
        const responseData = error.response.data;
        if (typeof responseData === 'string') {
          errorMessage = responseData;
        } else if (responseData.error && typeof responseData.error === 'object' && responseData.error.message) {
          // Handle the error handler format: {error: {message, status, type}}
          errorMessage = responseData.error.message;
        } else if (responseData.message && typeof responseData.message === 'string') {
          errorMessage = responseData.message;
        }
      } else if (error?.message && typeof error.message === 'string') {
        errorMessage = error.message;
      }
      
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">


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
                      placeholder="e.g., Local Stripe Service"
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
                  value: /^(0x)?[a-fA-F0-9]{40}$/i,
                  message: "Please enter a valid address (40 hex characters, with or without 0x prefix)"
                }
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Provider Address</FormLabel>
                  <FormControl>
                    <Input
                      placeholder="e.g., 3dc1e4bdb54f6cce80c92d5d494160545a78db35"
                      {...field}
                    />
                  </FormControl>
                  <FormDescription>
                    The address of the payment provider (40 hex characters, 0x prefix optional)
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
                    placeholder="e.g., http://localhost:3002/checkout"
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