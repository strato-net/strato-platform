import { useEffect, useState} from 'react';
import { useForm, useFieldArray } from 'react-hook-form';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus, X, FlaskConical } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useUser } from '@/context/UserContext';
import { simulateAdminVote, type SimulationResult } from '@/lib/simulate';
import SimulationResultPanel from './SimulationResultPanel';
import {
  buildValidatedAdminIssueArgs,
  validateAdminIssueArg,
} from './adminIssueArgs';
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
  const [isSimulating, setIsSimulating] = useState(false);
  const [simResult, setSimResult] = useState<SimulationResult | null>(null);
  const [simError, setSimError] = useState<string>('');

  // Drop any stale simulation when the modal re-opens.
  useEffect(() => {
    if (open) {
      setSimResult(null);
      setSimError('');
    }
  }, [open]);
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

  const getTypeName = (_type: object): string => {
    const tagName = _type['tag']?.toLocaleLowerCase() || 'string'
    if (tagName === 'array') {
      return getTypeName(_type['entry']) + '[]';
    } else {
      return tagName;
    }
  }

  // Validate/coerce the form args to their on-chain form (addresses get a 0x
  // prefix, ints stay numeric strings, strings get quoted), throwing on the
  // first bad value. Shared by submit and simulate so both send identical args.
  const buildValidatedArgs = (values: CreateAdminIssueFormValues): unknown[] =>
    buildValidatedAdminIssueArgs(values.args, functionArgs);

  const handleSimulate = async () => {
    const values = form.getValues();
    const target = values.target.trim();
    const func = values.func.trim();
    if (!target || !func) {
      toast({
        title: 'Incomplete',
        description: 'Enter a target contract and function first.',
        variant: 'destructive',
      });
      return;
    }
    let args: unknown[];
    try {
      args = buildValidatedArgs(values);
    } catch (err) {
      toast({
        title: 'Validation Failed',
        description: err instanceof Error ? err.message : 'Invalid arguments',
        variant: 'destructive',
      });
      return;
    }
    setIsSimulating(true);
    setSimResult(null);
    setSimError('');
    try {
      const res = await simulateAdminVote({ target, func, args });
      setSimResult(res);
    } catch (err) {
      setSimError(err instanceof Error ? err.message : 'Simulation failed');
    } finally {
      setIsSimulating(false);
    }
  };

  const onSubmit = async (values: CreateAdminIssueFormValues) => {
    // Clean up whitespace and empty args
    const trimmedTarget = values.target.trim();
    const trimmedFunc = values.func.trim();

    try {
      const argsArray = buildValidatedArgs(values);

      // Build payload with JSON-stringified target/func, and a JSON array for args
      const payload = {
        target: trimmedTarget,
        func: trimmedFunc,
        args: argsArray,
      };

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

      onOpenChange(false);
    } catch (err) {
      console.error('Create admin issue failed:', err);
      toast({
        title: 'Validation Failed',
        description: err instanceof Error ? err.message : 'Please check the inputs and try again.',
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
                  const [success, w] = validateAdminIssueArg({tag: 'Address'}, v);
                  return success ? true : (typeof w === 'string' ? w : 'Invalid address');
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
                            label={`${val.contractName ?? 'Storage'}`}
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
                        required: abiTypeName === 'string' ? false : 'Argument is required',
                        validate: (v) => {
                          const [success, w] = validateAdminIssueArg(abiType, v);
                          return success ? true : (typeof w === 'string' ? w : 'Invalid argument');
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

            {simResult || simError ? (
              <SimulationResultPanel result={simResult} error={simError} title="Proposal tx" />
            ) : null}

            {/* Actions */}
            <div className="flex justify-end gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleSimulate}
                disabled={isSimulating || isSubmitting}
              >
                {isSimulating ? (
                  <> <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Simulating… </>
                ) : (
                  <> <FlaskConical className="mr-2 h-4 w-4" /> Simulate </>
                )}
              </Button>
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
