import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Plus, Settings, AlertTriangle, Pause, Play, Edit, Save, X, Loader2
} from 'lucide-react';
import { cdpService, AssetConfig } from '@/services/cdpService';
import { toast } from 'sonner';

interface CollateralConfigFormData {
  asset: string;
  liquidationRatio: string;
  liquidationPenaltyBps: string;
  closeFactorBps: string;
  stabilityFeeRate: string;
  debtFloor: string;
  debtCeiling: string;
  unitScale: string;
  isPaused: boolean;
}

const EMPTY_FORM_DATA: CollateralConfigFormData = {
  asset: '', liquidationRatio: '', liquidationPenaltyBps: '', closeFactorBps: '',
  stabilityFeeRate: '', debtFloor: '', debtCeiling: '', unitScale: '', isPaused: false,
};

const FIELD_CONFIG = {
  asset: { name: 'Asset address', required: true, min: undefined, max: undefined },
  liquidationRatio: { name: 'Liquidation ratio', required: true, min: 0, max: undefined },
  liquidationPenaltyBps: { name: 'Liquidation penalty', required: true, min: 500, max: 3000 },
  closeFactorBps: { name: 'Close factor', required: true, min: 5000, max: 10000 },
  stabilityFeeRate: { name: 'Stability fee rate', required: true, min: 1.0, max: undefined },
  debtFloor: { name: 'Debt floor', required: true, min: 0, max: undefined },
  debtCeiling: { name: 'Debt ceiling', required: true, min: 0, max: undefined },
  unitScale: { name: 'Unit scale', required: true, min: 0, max: undefined },
} as const;

const CollateralConfigManager = () => {
  const [activeTab, setActiveTab] = useState('add');
  const [assets, setAssets] = useState<AssetConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<CollateralConfigFormData>(EMPTY_FORM_DATA);
  const [editingAsset, setEditingAsset] = useState<string | null>(null);
  const [globalPaused, setGlobalPaused] = useState<boolean>(false);
  const [hasUserInteracted, setHasUserInteracted] = useState(false);

  // Load data on mount
  useEffect(() => {
    Promise.all([loadAssets(), loadGlobalPaused()]);
  }, []);

  const loadGlobalPaused = useCallback(async () => {
    try {
      const result = await cdpService.getGlobalPaused();
      setGlobalPaused(result.isPaused);
    } catch (error) {
      console.error('Failed to load global pause status:', error);
    }
  }, []);

  const loadAssets = useCallback(async () => {
    try {
      setLoading(true);
      const supportedAssets = await cdpService.getSupportedAssets();
      setAssets(supportedAssets);
    } catch (error) {
      console.error('Failed to load assets:', error);
      toast.error('Failed to load assets');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleInputChange = useCallback((field: keyof CollateralConfigFormData, value: string | boolean) => {
    setHasUserInteracted(true);
    setFormData(prev => ({ ...prev, [field]: value }));
  }, []);

  const validateForm = useCallback((): string[] => {
    const errors: string[] = [];

    // Required field validation
    Object.entries(FIELD_CONFIG).forEach(([field, config]) => {
      const value = formData[field as keyof CollateralConfigFormData];
      if (config.required && (!value && value !== false)) {
        errors.push(`${config.name} is required`);
      }
    });

    // Numeric validation
    Object.entries(FIELD_CONFIG).forEach(([field, config]) => {
      const value = formData[field as keyof CollateralConfigFormData];
      if (typeof value === 'string' && value && config.min !== undefined) {
        const num = parseFloat(value);
        if (isNaN(num) || num < config.min || (config.max && num > config.max)) {
          const range = config.max ? `between ${config.min} and ${config.max}` : `at least ${config.min}`;
          errors.push(`${config.name} must be ${range}`);
        }
      }
    });

    // Cross-field validation
    const debtFloor = parseFloat(formData.debtFloor);
    const debtCeiling = parseFloat(formData.debtCeiling);
    if (debtCeiling > 0 && debtFloor > 0 && debtFloor > debtCeiling) {
      errors.push('Debt floor cannot be greater than debt ceiling');
    }

    return errors;
  }, [formData]);

  const isFormValid = useMemo(() => validateForm().length === 0, [validateForm]);
  const isFormEmpty = useMemo(() => Object.values(formData).some(v => !v && v !== false), [formData]);

  const getFieldError = useCallback((field: keyof CollateralConfigFormData): string | null => {
    if (!hasUserInteracted) return null;
    const errors = validateForm();
    return errors.find(error => 
      error.toLowerCase().includes(field.toLowerCase()) || 
      error.toLowerCase().includes(FIELD_CONFIG[field].name.toLowerCase())
    ) || null;
  }, [validateForm, hasUserInteracted]);

  const resetForm = useCallback(() => {
    setFormData(EMPTY_FORM_DATA);
    setEditingAsset(null);
    setHasUserInteracted(false);
  }, []);

  const convertToContractFormat = useCallback((data: CollateralConfigFormData) => {
    const RAY = BigInt(10) ** BigInt(27);
    const annualRate = parseFloat(data.stabilityFeeRate);
    const perSecondRate = annualRate / (365 * 24 * 60 * 60) / 100;
    const stabilityFeeRateRAY = (RAY + BigInt(Math.floor(perSecondRate * Number(RAY)))).toString();

    return {
      asset: data.asset,
      liquidationRatio: (BigInt(Math.floor(parseFloat(data.liquidationRatio) * 1e18))).toString(),
      liquidationPenaltyBps: data.liquidationPenaltyBps,
      closeFactorBps: data.closeFactorBps,
      stabilityFeeRate: stabilityFeeRateRAY,
      debtFloor: (BigInt(Math.floor(parseFloat(data.debtFloor) * 1e18))).toString(),
      debtCeiling: (BigInt(Math.floor(parseFloat(data.debtCeiling) * 1e18))).toString(),
      unitScale: (BigInt(Math.floor(parseFloat(data.unitScale) * 1e18))).toString(),
      isPaused: data.isPaused,
    };
  }, []);

  const handleSubmit = useCallback(async () => {
    const errors = validateForm();
    if (errors.length > 0) {
      toast.error(`Validation errors: ${errors.join(', ')}`);
      return;
    }

    try {
      setLoading(true);
      const configData = convertToContractFormat(formData);
      await cdpService.setCollateralConfig(configData);
      toast.success('Collateral configuration updated successfully');
      resetForm();
      await loadAssets();
    } catch (error) {
      console.error('Failed to set collateral config:', error);
      toast.error('Failed to update collateral configuration');
    } finally {
      setLoading(false);
    }
  }, [formData, validateForm, convertToContractFormat, resetForm, loadAssets]);

  const handleEditAsset = useCallback((asset: AssetConfig) => {
    setEditingAsset(asset.asset);
    setHasUserInteracted(true);
    setFormData({
      asset: asset.asset,
      liquidationRatio: (asset.liquidationRatio / 100).toString(),
      liquidationPenaltyBps: asset.liquidationPenaltyBps.toString(),
      closeFactorBps: asset.closeFactorBps.toString(),
      stabilityFeeRate: asset.stabilityFeeRate.toString(),
      debtFloor: (parseFloat(asset.debtFloor) / 1e18).toString(),
      debtCeiling: (parseFloat(asset.debtCeiling) / 1e18).toString(),
      unitScale: (parseFloat(asset.unitScale) / 1e18).toString(),
      isPaused: asset.isPaused,
    });
    setActiveTab('add');
  }, []);

  const handleTogglePause = useCallback(async (asset: string, isPaused: boolean) => {
    try {
      setLoading(true);
      await cdpService.setAssetPaused(asset, isPaused);
      toast.success(`Asset ${isPaused ? 'paused' : 'unpaused'} successfully`);
      await loadAssets();
    } catch (error) {
      console.error('Failed to toggle asset pause:', error);
      toast.error('Failed to toggle asset pause');
    } finally {
      setLoading(false);
    }
  }, [loadAssets]);

  const handleToggleGlobalPause = useCallback(async () => {
    try {
      setLoading(true);
      const newPausedState = !globalPaused;
      await cdpService.setGlobalPaused(newPausedState);
      setGlobalPaused(newPausedState);
      toast.success(`CDP system ${newPausedState ? 'paused' : 'unpaused'} successfully`);
    } catch (error) {
      console.error('Failed to toggle global pause:', error);
      toast.error('Failed to toggle global pause');
    } finally {
      setLoading(false);
    }
  }, [globalPaused]);

  const formatValue = useCallback((value: string, type: 'percentage' | 'usd' | 'bps' | 'raw') => {
    const num = parseFloat(value);
    switch (type) {
      case 'percentage': return `${(num / 100).toFixed(2)}%`;
      case 'usd': return `$${(num / 1e18).toFixed(2)}`;
      case 'bps': return `${(num / 100).toFixed(2)}%`;
      default: return value;
    }
  }, []);

  const FormField = ({ field, label, type = "text", placeholder, min, max, step, helpText, ...props }: any) => (
    <div className="space-y-2">
      <Label htmlFor={field}>{label}</Label>
      <Input
        id={field}
        type={type}
        placeholder={placeholder}
        value={formData[field]}
        onChange={(e) => handleInputChange(field, e.target.value)}
        className={getFieldError(field) ? 'border-red-500' : ''}
        min={min}
        max={max}
        step={step}
        {...props}
      />
      {getFieldError(field) && (
        <p className="text-xs text-red-500">{getFieldError(field)}</p>
      )}
      {helpText && <p className="text-sm text-gray-500">{helpText}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Global Pause Control */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center space-x-2">
              <AlertTriangle className="h-5 w-5" />
              <span>System Control</span>
            </span>
            <Button
              onClick={handleToggleGlobalPause}
              disabled={loading}
              variant={globalPaused ? "destructive" : "default"}
              className="flex items-center space-x-2"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : globalPaused ? (
                <Play className="h-4 w-4" />
              ) : (
                <Pause className="h-4 w-4" />
              )}
              <span>{globalPaused ? 'Unpause System' : 'Pause System'}</span>
            </Button>
          </CardTitle>
          <CardDescription>
            {globalPaused ? (
              <span className="text-red-600 font-medium">
                ⚠️ CDP system is paused - All operations are blocked
              </span>
            ) : (
              <span className="text-green-600 font-medium">
                ✅ CDP system is active - All operations are allowed
              </span>
            )}
          </CardDescription>
        </CardHeader>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="add" className="flex items-center space-x-2">
            <Plus className="h-4 w-4" />
            <span>Add/Edit Config</span>
          </TabsTrigger>
          <TabsTrigger value="manage" className="flex items-center space-x-2">
            <Settings className="h-4 w-4" />
            <span>Manage Assets</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="add" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Settings className="h-5 w-5" />
                <span>Collateral Asset Configuration</span>
              </CardTitle>
              <CardDescription>
                Configure risk parameters for collateral assets in the CDP system
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <FormField
                  field="asset"
                  label="Asset Address"
                  placeholder="0x..."
                  disabled={editingAsset !== null}
                />

                <FormField
                  field="liquidationRatio"
                  label="Liquidation Ratio (e.g., 1.5 = 150%)"
                  type="number"
                  step="0.1"
                  min="1.0"
                  placeholder="1.5"
                />

                <FormField
                  field="liquidationPenaltyBps"
                  label="Liquidation Penalty (Basis Points)"
                  type="number"
                  min="500"
                  max="3000"
                  placeholder="1000"
                  helpText="500-3000 bps (5%-30%)"
                />

                <FormField
                  field="closeFactorBps"
                  label="Close Factor (Basis Points)"
                  type="number"
                  min="5000"
                  max="10000"
                  placeholder="5000"
                  helpText="5000-10000 bps (50%-100%)"
                />

                <FormField
                  field="stabilityFeeRate"
                  label="Stability Fee Rate (RAY)"
                  placeholder="1.0"
                  helpText="Per-second interest rate (minimum 1.0 = 0% interest)"
                />

                <FormField
                  field="debtFloor"
                  label="Debt Floor (USD)"
                  type="number"
                  min="0"
                  placeholder="100"
                />

                <FormField
                  field="debtCeiling"
                  label="Debt Ceiling (USD)"
                  placeholder="Enter debt ceiling (e.g., 1000000 for $1M)"
                  helpText="Enter the full number (e.g., 1000000 not 1e+6)"
                />

                <FormField
                  field="unitScale"
                  label="Unit Scale"
                  placeholder="Enter unit scale (e.g., 1 for 18 decimals)"
                  helpText="Enter decimal value (e.g., 1 for 18 decimals, 0.001 for 15 decimals)"
                />

                {/* Pause Status */}
                <div className="space-y-2">
                  <Label htmlFor="isPaused">Pause Asset</Label>
                  <div className="flex items-center space-x-2">
                    <Switch
                      id="isPaused"
                      checked={formData.isPaused}
                      onCheckedChange={(checked) => handleInputChange('isPaused', checked)}
                    />
                    <Label htmlFor="isPaused">
                      {formData.isPaused ? 'Paused' : 'Active'}
                    </Label>
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-4">
                <Button 
                  onClick={handleSubmit} 
                  disabled={loading || isFormEmpty || !isFormValid}
                  className="flex items-center space-x-2"
                >
                  {loading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  <span>{editingAsset ? 'Update Config' : 'Add Config'}</span>
                </Button>
                
                {editingAsset && (
                  <Button 
                    variant="outline" 
                    onClick={resetForm}
                    disabled={loading}
                  >
                    <X className="h-4 w-4 mr-2" />
                    Cancel Edit
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="manage" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center space-x-2">
                <Settings className="h-5 w-5" />
                <span>Manage Collateral Assets</span>
              </CardTitle>
              <CardDescription>
                View and manage existing collateral asset configurations
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-strato-blue" />
                </div>
              ) : !assets.length ? (
                <Alert>
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    No collateral assets configured yet. Add your first asset using the "Add/Edit Config" tab.
                  </AlertDescription>
                </Alert>
              ) : (
                <div className="space-y-4">
                  {assets.map((asset) => (
                    <Card key={asset.asset} className="border-l-4 border-l-strato-blue">
                      <CardContent className="pt-6">
                        <div className="flex items-center justify-between">
                          <div className="space-y-2">
                            <div className="flex items-center space-x-2">
                              <h3 className="font-semibold">{asset.symbol}</h3>
                              <Badge variant={asset.isPaused ? "destructive" : "default"}>
                                {asset.isPaused ? 'Paused' : 'Active'}
                              </Badge>
                              <Badge variant="outline">
                                {asset.isSupported ? 'Supported' : 'Not Supported'}
                              </Badge>
                            </div>
                            <p className="text-sm text-gray-500 font-mono">{asset.asset}</p>
                          </div>
                          
                          <div className="flex items-center space-x-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleEditAsset(asset)}
                              disabled={loading}
                            >
                              <Edit className="h-4 w-4 mr-1" />
                              Edit
                            </Button>
                            
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleTogglePause(asset.asset, !asset.isPaused)}
                              disabled={loading}
                            >
                              {asset.isPaused ? (
                                <>
                                  <Play className="h-4 w-4 mr-1" />
                                  Unpause
                                </>
                              ) : (
                                <>
                                  <Pause className="h-4 w-4 mr-1" />
                                  Pause
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
                          <div>
                            <p className="text-sm text-gray-500">Liquidation Ratio</p>
                            <p className="font-semibold">{formatValue(asset.liquidationRatio.toString(), 'percentage')}</p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-500">Penalty</p>
                            <p className="font-semibold">{formatValue(asset.liquidationPenaltyBps.toString(), 'bps')}</p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-500">Close Factor</p>
                            <p className="font-semibold">{formatValue(asset.closeFactorBps.toString(), 'bps')}</p>
                          </div>
                          <div>
                            <p className="text-sm text-gray-500">Debt Floor</p>
                            <p className="font-semibold">{formatValue(asset.debtFloor, 'usd')}</p>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default CollateralConfigManager;