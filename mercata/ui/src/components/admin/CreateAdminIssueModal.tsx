import { useEffect, useState} from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/context/UserContext';
import * as React from 'react';

type CreateAdminIssueFormValues = {
  target: string;               // Contract Address (raw string in the input)
  func: string;                 // Function Name   (raw string in the input)
  args: { value: string }[];    // Dynamic list of argument strings
};

interface CreateAdminIssueModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // Will be called with JSON-stringified target/func and a JSON array (string[])
  handleCastVoteOnIssue: (target: string, func: string, args: any[]) => Promise<void> | void;
}

const CreateAdminIssueModal: React.FC<CreateAdminIssueModalProps> = ({
  open,
  onOpenChange,
  handleCastVoteOnIssue,
}) => {
  const { toast } = useToast();
  const { contractSearch, contractSearchResults, contractSearchResultsLoading,
          getContractDetails, contractDetailsResults, contractDetailsResultsLoading } = useUser();
  const [selectedFunction, setSelectedFunction] = useState('');
  const searchObjects = contractSearchResults.reduce((b, a) => {
    if (a['address']) {
      const aa = { ...b[a['address']], ...a } 
      return { ...b, [a['address']]: aa };
    } else {
      return b;
    }
  }, {});
  const searchAddresses = Object.keys(searchObjects);

  const form = useForm<CreateAdminIssueFormValues>({
    defaultValues: {
      target: '',
      func: '',
      args: [{ value: '' }],
    },
    mode: 'onChange',
  });

  const allContractFunctions = (contractDetailsResults || {})['_functions'] || {};
  const contractFunctions = (Object.entries(allContractFunctions) || []).filter(([N, t]) => {
    return t['_funcVisibility'] !== 'internal' && t['_funcVisibility'] !== 'private';
  }).map(([N, t]) => N);

  const { fields, replace } = useFieldArray({ control: form.control, name: 'args' });

  const functionArgs = (allContractFunctions[selectedFunction] || {})._funcArgs as Array<[string, { type?: { tag?: string } }]> | undefined;
  
  useEffect(() => {
    if (Array.isArray(functionArgs) && functionArgs.length > 0) {
      replace(functionArgs.map(() => ({ value: '' })));
    } else {
      replace([]);
    }
  }, [functionArgs?.length, replace]);

  const validateFunctionArg = (_type: object, value: string): [boolean, any?] => {
    const tag = _type['tag']?.toLocaleLowerCase() || 'string'
    if (tag === 'int') {
      try {
        const i = JSON.parse(value.trim());
        return [true, i];
      } catch(e) {
        return [false, `Invalid integer value: ${value}`];
      }
    }
    if (tag === 'bool') {
      const b = value.toLocaleLowerCase();
      if (b === 'true' || b === 'false') {
        return [true, b === 'true'];
      } else {
        return [false, `Invalid boolean value: ${value}`];
      }
    }
    if (tag === 'address') {
      const lowercase = value.toLocaleLowerCase();
      const isHex = /^(0x)?[0-9A-Fa-f]{1,40}$/.test(lowercase);
      if (!isHex) {
        return [false, `Invalid address: ${value}`];
      }
      if (lowercase.substring(0,2) !== '0x') {
        return [true, `0x${lowercase}`];
      } else {
        return [true, lowercase];
      }
    }
    if (tag === 'array') {
      try {
        const arr = JSON.parse(value);
        if (!Array.isArray(arr)) {
          return [false, 'Invalid array'];
        }
        return arr.reduce(([success, prev], val) => {
          if (success) {
            const [newSuccess, newVal] = validateFunctionArg(_type['entry'], val);
            if (newSuccess) {
              return [newSuccess, [...prev, newVal]];
            } else {
              return [newSuccess, newVal];
            }
          } else {
            return [success, prev];
          }
        }, [true, []]);
      } catch {
        return [false, 'Invalid JSON'];
      }
    }
    return [true, `"${value.trim().replace("\"","\\\"")}"`];
  }

  const getTypeName = (_type: object): string => {
    const tagName = _type['tag']?.toLocaleLowerCase() || 'string'
    if (tagName === 'array') {
      return getTypeName(_type['entry']) + '[]';
    } else {
      return tagName;
    }
  }

  const onSubmit = async (values: CreateAdminIssueFormValues) => {
    // Clean up whitespace and empty args
    const trimmedTarget = values.target.trim();
    const trimmedFunc = values.func.trim();
    const argsArray = values.args
      .map((a, i) => {
        const [success, v] = validateFunctionArg(functionArgs[i][1].type || {}, a.value);
        if (!success) {
          throw v;
        }
        return v;
      });

    // Build payload with JSON-stringified target/func, and a JSON array for args
    const payload = {
      target: trimmedTarget,
      func: trimmedFunc,
      args: argsArray, // already a string[]
    };

    try {
      await handleCastVoteOnIssue(payload.target, payload.func, payload.args);

      toast({
        title: 'Issue Created',
        description: 'Your admin issue has been submitted for voting.',
      });

      form.reset({
        target: '',
        func: '',
        args: [{ value: '' }],
      });

      onOpenChange(false); // close the modal
    } catch (err) {
      // Let your global interceptor handle toasts if you prefer;
      // this is a friendly fallback.
      console.error('Create admin issue failed:', err);
      toast({
        title: 'Failed to create issue',
        description: 'Please check the inputs and try again.',
        variant: 'destructive',
      });
    }
  };

  const isSubmitting = form.formState.isSubmitting;

  return (
    <Dialog open={open} onOpenChange={(o) => !isSubmitting && onOpenChange(o)}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Create Admin Issue</DialogTitle>
          <DialogDescription>
            Prepare a proposal for admins to vote on. Provide the target contract, function, and arguments.
          </DialogDescription>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Contract Address */}
            <FormField
              control={form.control}
              name="target"
              rules={{
                required: 'Contract address is required',
                validate: (v) => {
                  const [success, w] = validateFunctionArg({tag: 'Address'}, v);
                  return success || w;
                },
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Contract Address</FormLabel>
                  <FormControl>
                    <div>
                      <Input
                        {...field}
                        list="contract-search"
                        onChange={(e) => {
                          field.onChange(e);
                          contractSearch(e.target.value);
                        }}
                        onBlur={(e) => {
                          field.onBlur();
                          const val = e.target.value.trim();
                          if (searchAddresses.includes(val)) {
                            getContractDetails(val);
                          }
                        }}
                      />
                      <datalist id="contract-search">
                        {Object.entries(searchObjects).map(([address, val]: any) => (
                          <option
                            key={address}
                            value={address}
                            label={`${val.contractName ?? 'Storage'} - ${address}`}
                          />
                        ))}
                      </datalist>
                    </div>
                  </FormControl>
                  <FormDescription>The on-chain address of the target contract.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Function Name */}
            <FormField
              control={form.control}
              name="func"
              rules={{
                required: 'Function name is required',
                validate: (v) => v.trim().length > 0 || 'Function name cannot be empty',
              }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Function Name</FormLabel>
                  <FormControl>
                    <Select
                      value={field.value}
                      onValueChange={(v) => {
                        field.onChange(v);
                        setSelectedFunction(v);
                      }}
                      disabled={contractSearchResultsLoading || contractDetailsResultsLoading}
                    >
                      <SelectTrigger id="select-function">
                        <SelectValue placeholder="Select function" />
                      </SelectTrigger>
                      <SelectContent>
                        {contractFunctions.map((fn) => (
                          <SelectItem key={fn} value={fn}>{fn}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormDescription>The exact function to call.</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            {/* Arguments (dynamic) */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <FormLabel>Arguments</FormLabel>
              </div>

              <div className="space-y-2">
                {fields.map((f, idx) => {
                  const abi = functionArgs?.[idx];
                  const abiName = abi?.[0];
                  const abiType = abi?.[1]?.type || {tag: 'String'};
                  const abiTypeName = getTypeName(abiType);
              
                  return (
                    <FormField
                      key={f.id}
                      control={form.control}
                      name={`args.${idx}.value`}
                      rules={{
                        required: 'Argument is required',
                        validate: (v) => {
                          const [success, w] = validateFunctionArg(abiType, v);
                          return success || w;
                        },
                        // add per-type validation here if desired (e.g., address, uint, etc.)
                      }}
                      render={({ field: argField }) => (
                        <FormItem>
                          <div className="flex items-center gap-2">
                            <FormControl className="flex-1">
                              <Input
                                {...argField}
                                placeholder={
                                  abiName ? `${abiName}: ${abiTypeName}` : `Argument ${idx + 1}`
                                }
                              />
                            </FormControl>
                          </div>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  );
                })}
              </div>
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting || !form.formState.isValid}
                className="bg-strato-blue hover:bg-strato-blue/90"
              >
                {isSubmitting ? (<> <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Submitting… </>) : 'Create Issue'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
};

export default CreateAdminIssueModal;
