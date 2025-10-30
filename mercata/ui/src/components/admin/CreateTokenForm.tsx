import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Info, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { useTokenContext } from '@/context/TokenContext';
import { CreateTokenValues } from '@/interface';


const CreateTokenForm = () => {
  const { createToken, loading, error } = useTokenContext();
  const { toast } = useToast();
  
  const [imagePreview, setImagePreview] = useState<string>('');
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  
  const form = useForm<CreateTokenValues>({
    defaultValues: {
      name: '',
      description: '',
      images: [],
      files: [],
      fileNames: [],
      symbol: '',
      initialSupply: '',
      customDecimals: 18,
    },
  });

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      // Validate file type
      if (!file.type.startsWith('image/')) {
        toast({
          title: 'Invalid File Type',
          description: 'Please select an image file.',
          variant: 'destructive',
        });
        return;
      }
      
      // Validate file size (5MB limit)
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
      
      // Validate file sizes (10MB limit per file)
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


  const onSubmit = async (data: CreateTokenValues) => {
    try {
      // Convert image file to base64 if present
      let imageBase64 = '';
      if (data.image) {
        try {
          const reader = new FileReader();
          imageBase64 = await new Promise<string>((resolve, reject) => {
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('Failed to read image file'));
            reader.readAsDataURL(data.image!);
          });
        } catch (imageError) {
          toast({
            title: 'Image Processing Error',
            description: 'Failed to process the selected image.',
            variant: 'destructive',
          });
          return;
        }
      }

      // Convert files to base64 if present
      const filesBase64: string[] = [];
      if (data.files && data.files.length > 0) {
        try {
          for (const file of data.files) {
            const reader = new FileReader();
            const fileBase64 = await new Promise<string>((resolve, reject) => {
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = () => reject(new Error(`Failed to read file: ${file.name}`));
              reader.readAsDataURL(file);
            });
            filesBase64.push(fileBase64);
          }
        } catch (fileError) {
          toast({
            title: 'File Processing Error',
            description: 'Failed to process one or more uploaded files.',
            variant: 'destructive',
          });
          return;
        }
      }

      // Call the context method to create the token
      await createToken({
        name: data.name,
        symbol: data.symbol,
        initialSupply: data.initialSupply,
        description: data.description,
        images: imageBase64 ? [imageBase64] : [],
        files: filesBase64,
        fileNames: data.fileNames,
        customDecimals: data.customDecimals,
      });

      toast({
        title: 'Token Created Successfully',
        description: `${data.name} (${data.symbol}) has been deployed to the blockchain.`,
      });

      // Reset form and image preview after successful creation
      form.reset();
      setImagePreview('');
      setUploadedFiles([]);
    } catch (error) {
      toast({
        title: 'Error Creating Token',
        description: error?.message || 'Failed to create token. Please try again.',
        variant: 'destructive',
      });
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
                  The full name of your token
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
            name="initialSupply"
            rules={{ 
              required: 'Total supply is required',
              pattern: {
                value: /^\d+$/,
                message: 'Total supply must be a number'
              }
            }}
            render={({ field }) => (
              <FormItem>
                <FormLabel>Total Supply</FormLabel>
                <FormControl>
                  <Input placeholder="1000000" {...field} />
                </FormControl>
                <FormDescription>
                  The total number of tokens to mint
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
              Upload an image for your token (optional)
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
                    placeholder="Describe your token and its purpose..." 
                    className="min-h-[100px] resize-none" 
                    {...field} 
                  />
                </FormControl>
                <FormDescription>
                  Provide a clear description of your token
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
                    <p className="text-sm text-gray-600">Uploaded files:</p>
                    <div className="grid grid-cols-1 gap-2">
                      {uploadedFiles.map((file, index) => (
                        <div key={index} className="flex items-center justify-between p-2 bg-gray-50 rounded-md">
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
              Upload additional files related to your token (optional)
            </FormDescription>
          </FormItem>
        </div>
        
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            Creating a token will deploy a new smart contract to the blockchain. 
            This action cannot be undone and may incur gas fees.
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
                Creating Token...
              </>
            ) : (
              'Create Token'
            )}
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default CreateTokenForm;