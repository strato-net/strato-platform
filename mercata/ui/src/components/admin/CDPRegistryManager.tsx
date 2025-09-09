import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { 
  Settings, 
  AlertTriangle, 
  CheckCircle, 
  Save,
  Loader2,
  Database
} from 'lucide-react';
import { cdpService } from '@/services/cdpService';
import { toast } from 'sonner';

interface RegistryData {
  cdpVault: string;
  cdpEngine: string;
  priceOracle: string;
  usdst: string;
  tokenFactory: string;
  feeCollector: string;
}

const CDPRegistryManager = () => {
  const [loading, setLoading] = useState(false);
  const [registryData, setRegistryData] = useState<RegistryData>({
    cdpVault: '',
    cdpEngine: '',
    priceOracle: '',
    usdst: '',
    tokenFactory: '',
    feeCollector: '',
  });

  const handleInputChange = useCallback((field: keyof RegistryData, value: string) => {
    setRegistryData(prev => ({
      ...prev,
      [field]: value
    }));
  }, []);

  const validateAddresses = useCallback((): string[] => {
    const errors: string[] = [];
    const addressRegex = /^0x[a-fA-F0-9]{40}$/;
    
    Object.entries(registryData).forEach(([key, value]) => {
      if (!value) {
        errors.push(`${key} address is required`);
      } else if (!addressRegex.test(value)) {
        errors.push(`${key} must be a valid Ethereum address`);
      }
    });

    return errors;
  }, [registryData]);

  const handleUpdateRegistry = useCallback(async () => {
    const errors = validateAddresses();
    if (errors.length > 0) {
      toast.error(`Validation errors: ${errors.join(', ')}`);
      return;
    }

    try {
      setLoading(true);
      await cdpService.setRegistry(registryData);
      toast.success('Registry updated successfully');
    } catch (error) {
      console.error('Failed to update registry:', error);
      toast.error('Failed to update registry');
    } finally {
      setLoading(false);
    }
  }, [registryData, validateAddresses]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center space-x-2">
          <Database className="h-5 w-5" />
          <span>CDP Registry Management</span>
        </CardTitle>
        <CardDescription>
          Update CDP system component addresses and registry configuration
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>Warning:</strong> Updating registry addresses will affect all CDP operations. 
            Ensure all addresses are correct and contracts are properly deployed.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="cdpVault">CDP Vault Address</Label>
            <Input
              id="cdpVault"
              placeholder="0x..."
              value={registryData.cdpVault}
              onChange={(e) => handleInputChange('cdpVault', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cdpEngine">CDP Engine Address</Label>
            <Input
              id="cdpEngine"
              placeholder="0x..."
              value={registryData.cdpEngine}
              onChange={(e) => handleInputChange('cdpEngine', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="priceOracle">Price Oracle Address</Label>
            <Input
              id="priceOracle"
              placeholder="0x..."
              value={registryData.priceOracle}
              onChange={(e) => handleInputChange('priceOracle', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="usdst">USDST Token Address</Label>
            <Input
              id="usdst"
              placeholder="0x..."
              value={registryData.usdst}
              onChange={(e) => handleInputChange('usdst', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="tokenFactory">Token Factory Address</Label>
            <Input
              id="tokenFactory"
              placeholder="0x..."
              value={registryData.tokenFactory}
              onChange={(e) => handleInputChange('tokenFactory', e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="feeCollector">Fee Collector Address</Label>
            <Input
              id="feeCollector"
              placeholder="0x..."
              value={registryData.feeCollector}
              onChange={(e) => handleInputChange('feeCollector', e.target.value)}
            />
          </div>
        </div>

        <div className="flex items-center space-x-4">
          <Button 
            onClick={handleUpdateRegistry} 
            disabled={loading}
            className="flex items-center space-x-2"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            <span>Update Registry</span>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default CDPRegistryManager;
