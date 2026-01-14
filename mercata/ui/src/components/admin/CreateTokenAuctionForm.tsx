import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Info, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface CreateTokenAuctionValues {
  name: string;
  description: string;
  symbol: string;
  tokenAmount: string;
  customDecimals: number;
  minPrice: string;
  maxPrice: string;
  durationDays: number;
  image?: File;
  files?: File[];
  fileNames?: string[];
}

const CreateTokenAuctionForm = () => {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [imagePreview, setImagePreview] = useState<string>('');
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);

  const form = useForm<CreateTokenAuctionValues>({
    defaultValues: {
      name: '',
      description: '',
      symbol: '',
      tokenAmount: '',
      customDecimals: 18,
      minPrice: '',
      maxPrice: '',
      durationDays: 7,
      files: [],
      fileNames: [],
    },
  });

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        toast({
          title: 'Invalid File Type',
          description: 'Please select an image file.',
          variant: 'destructive',
        });
        return;
      }

      if (file.size > 5 * 1024 * 1024) {
        toast({
          title: 'File Too Large',
          description: 'Image must be smaller than 5MB.',
          variant: 'destructive',
        });
        return;
      }

      form.setValue('image', file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files) {
      const fileArray = Array.from(files);

      const oversizedFiles = fileArray.filter(file => file.size > 10 * 1024 * 1024);
      if (oversizedFiles.length > 0) {
        toast({
          title: 'Files Too Large',
          description: `${oversizedFiles.length} file(s) exceed 10MB limit.`,
          variant: 'destructive',
        });
        return;
      }

      const newFiles = [...uploadedFiles, ...fileArray];
      const fileNames = newFiles.map(file => file.name);

      setUploadedFiles(newFiles);
      form.setValue('files', newFiles);
      form.setValue('fileNames', fileNames);
    }
  };

  const removeFile = (index: number) => {
    const newFiles = uploadedFiles.filter((_, i) => i !== index);
    const fileNames = newFiles.map(file => file.name);

    setUploadedFiles(newFiles);
    form.setValue('files', newFiles);
    form.setValue('fileNames', fileNames);
  };

  const onSubmit = async (data: CreateTokenAuctionValues) => {
    try {
      setLoading(true);

      // Convert image file to base64 if present
      let imageBase64 = '';
      if (data.image) {
        const reader = new FileReader();
        imageBase64 = await new Promise<string>((resolve, reject) => {
          reader.onloadend = () => resolve(reader.result as string);
          reader.onerror = () => reject(new Error('Failed to read image file'));
          reader.readAsDataURL(data.image!);
        });
      }

      // Convert files to base64 if present
      const filesBase64: string[] = [];
      if (data.files && data.files.length > 0) {
        for (const file of data.files) {
          const reader = new FileReader();
          const fileBase64 = await new Promise<string>((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
            reader.readAsDataURL(file);
          });
          filesBase64.push(fileBase64);
        }
      }

      // Convert duration from days to seconds
      const durationSeconds = data.durationDays * 24 * 60 * 60;

      // TODO: Call auction contract to create auction
      // This would require integration with the TokenAuction contract
      // Example:
      // await auctionContract.createAuction(
      //   data.name,
      //   data.description,
      //   imageBase64 ? [imageBase64] : [],
      //   filesBase64,
      //   data.fileNames,
      //   data.symbol,
      //   data.tokenAmount,
      //   data.customDecimals,
      //   data.minPrice,
      //   data.maxPrice,
      //   durationSeconds
      // );

      toast({
        title: 'Token Auction Created',
        description: `${data.name} (${data.symbol}) auction will run for ${data.durationDays} days.`,
      });

      form.reset();
      setImagePreview('');
      setUploadedFiles([]);
    } catch (error) {
      toast({
        title: 'Error Creating Auction',
        description: error?.message || 'Failed to create token auction. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <FormField
            control={form.control}
            name="name"
            rules={{ required: 'Token name is required' }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Token Name</FormLabel>
                <FormControl>
                  <Input placeholder="Gold Token" {...field} />
                </FormControl>
                <FormDescription>
                  The full name of the token to be auctioned
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="symbol"
            rules={{
              required: 'Token symbol is required',
              pattern: {
                value: /^[A-Z]+$/,
                message: 'Symbol must be uppercase letters only'
              },
              maxLength: {
                value: 10,
                message: 'Symbol must be 10 characters or less'
              }
            }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Token Symbol</FormLabel>
                <FormControl>
                  <Input
                    placeholder="GOLD"
                    {...field}
                    onChange={(e) => {
                      const uppercaseValue = e.target.value.toUpperCase();
                      field.onChange(uppercaseValue);
                    }}
                  />
                </FormControl>
                <FormDescription>
                  The ticker symbol (e.g., GOLD, BTC)
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="tokenAmount"
            rules={{
              required: 'Token amount is required',
              pattern: {
                value: /^\d+$/,
                message: 'Token amount must be a number'
              }
            }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Total Tokens for Auction</FormLabel>
                <FormControl>
                  <Input placeholder="1000000" {...field} />
                </FormControl>
                <FormDescription>
                  The total number of tokens to auction
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="durationDays"
            rules={{
              required: 'Duration is required',
              min: { value: 1, message: 'Minimum 1 day' },
              max: { value: 30, message: 'Maximum 30 days' }
            }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Auction Duration (days)</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    placeholder="7"
                    {...field}
                    onChange={(e) => field.onChange(parseInt(e.target.value))}
                  />
                </FormControl>
                <FormDescription>
                  How long the auction will run (1-30 days)
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="minPrice"
            rules={{
              required: 'Minimum price is required',
              pattern: {
                value: /^\d+(\.\d+)?$/,
                message: 'Must be a valid number'
              }
            }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Minimum Price (USDST per token)</FormLabel>
                <FormControl>
                  <Input placeholder="1.0" {...field} />
                </FormControl>
                <FormDescription>
                  Minimum acceptable price per token
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="maxPrice"
            rules={{
              required: 'Maximum price is required',
              pattern: {
                value: /^\d+(\.\d+)?$/,
                message: 'Must be a valid number'
              },
              validate: (value) => {
                const minPrice = parseFloat(form.getValues('minPrice') || '0');
                const maxPrice = parseFloat(value);
                return maxPrice >= minPrice || 'Maximum price must be greater than or equal to minimum price';
              }
            }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Maximum Price (USDST per token)</FormLabel>
                <FormControl>
                  <Input placeholder="10.0" {...field} />
                </FormControl>
                <FormDescription>
                  Maximum price per token
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormItem>
            <FormLabel>Token Image</FormLabel>
            <FormControl>
              <div className="space-y-4">
                <Input
                  type="file"
                  accept="image/*"
                  onChange={handleImageChange}
                  className="cursor-pointer"
                />
                {imagePreview && (
                  <div className="mt-2">
                    <img
                      src={imagePreview}
                      alt="Token preview"
                      className="w-24 h-24 object-cover rounded-lg border"
                    />
                  </div>
                )}
              </div>
            </FormControl>
            <FormDescription>
              Upload an image for the token (optional)
            </FormDescription>
          </FormItem>

          <FormField
            control={form.control}
            name="description"
            rules={{ required: 'Token description is required' }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl>
                  <Textarea
                    placeholder="Describe the token and auction details..."
                    className="min-h-[100px] resize-none"
                    {...field}
                  />
                </FormControl>
                <FormDescription>
                  Provide details about the token and auction
                </FormDescription>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>

        <div className="space-y-4">
          <FormItem>
            <FormLabel>Additional Files</FormLabel>
            <FormControl>
              <div className="space-y-4">
                <Input
                  type="file"
                  multiple
                  onChange={handleFileUpload}
                  className="cursor-pointer"
                />
                {uploadedFiles.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">Uploaded files:</p>
                    <div className="grid grid-cols-1 gap-2">
                      {uploadedFiles.map((file, index) => (
                        <div key={index} className="flex items-center justify-between p-2 bg-muted/50 rounded-md">
                          <span className="text-sm truncate">{file.name}</span>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeFile(index)}
                            className="h-6 w-6 p-0"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </FormControl>
            <FormDescription>
              Upload documentation or whitepaper (optional)
            </FormDescription>
          </FormItem>
        </div>

        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Creating a token auction will deploy a new smart contract and make the tokens available
            for public sale. Users will commit USDST during the auction period, and the final price
            will be determined by total commitments divided by available tokens (clamped to min/max bounds).
          </AlertDescription>
        </Alert>

        <div className="flex justify-end space-x-4">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              form.reset();
              setImagePreview('');
              setUploadedFiles([]);
            }}
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
                Creating Auction...
              </>
            ) : (
              'Create Token Auction'
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default CreateTokenAuctionForm;
