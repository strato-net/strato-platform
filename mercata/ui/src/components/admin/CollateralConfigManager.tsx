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
  Plus, 
  Settings, 
  AlertTriangle, 
  Pause, 
  Play,
  Edit,
  Save,
  X,
  Loader2
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

// Empty form data - no hardcoded defaults
const EMPTY_FORM_DATA: CollateralConfigFormData = {
  asset: '',
  liquidationRatio: '',
  liquidationPenaltyBps: '',
  closeFactorBps: '',
  stabilityFeeRate: '',
  debtFloor: '',
  debtCeiling: '',
  unitScale: '',
  isPaused: false,
};

const CollateralConfigManager = () => {
  const [activeTab, setActiveTab] = useState('add');
  const [assets, setAssets] = useState<AssetConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState<CollateralConfigFormData>(EMPTY_FORM_DATA);
  const [editingAsset, setEditingAsset] = useState<string | null>(null);

  // Load existing assets on component mount
  useEffect(() => {
    loadAssets();
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
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  }, []);

  // Helper function to check for scientific notation
  const hasScientificNotation = useCallback((value: string): boolean => {
    return value.includes('e+') || value.includes('e-') || value.includes('E+') || value.includes('E-');
  }, []);

  const validateForm = useCallback((): string[] => {
    const errors: string[] = [];
    const requiredFields = [
      { field: 'asset', name: 'Asset address' },
      { field: 'liquidationRatio', name: 'Liquidation ratio' },
      { field: 'liquidationPenaltyBps', name: 'Liquidation penalty' },
      { field: 'closeFactorBps', name: 'Close factor' },
      { field: 'stabilityFeeRate', name: 'Stability fee rate' },
      { field: 'debtFloor', name: 'Debt floor' },
      { field: 'debtCeiling', name: 'Debt ceiling' },
      { field: 'unitScale', name: 'Unit scale' }
    ];

    // Required field validation
    requiredFields.forEach(({ field, name }) => {
      if (!formData[field as keyof CollateralConfigFormData]) {
        errors.push(`${name} is required`);
      }
    });

    // Scientific notation validation
    if (formData.debtCeiling && hasScientificNotation(formData.debtCeiling)) {
      errors.push('Debt ceiling cannot use scientific notation');
    }
    if (formData.unitScale && hasScientificNotation(formData.unitScale)) {
      errors.push('Unit scale cannot use scientific notation');
    }

    // Numeric validation
    const liquidationRatio = parseFloat(formData.liquidationRatio);
    if (formData.liquidationRatio && (isNaN(liquidationRatio) || liquidationRatio <= 0)) {
      errors.push('Liquidation ratio must be a positive number');
    }

    const stabilityFeeRate = parseFloat(formData.stabilityFeeRate);
    if (formData.stabilityFeeRate && (isNaN(stabilityFeeRate) || stabilityFeeRate < 1.0)) {
      errors.push('Stability fee rate must be at least 1.0');
    }

    const debtFloor = parseFloat(formData.debtFloor);
    const debtCeiling = parseFloat(formData.debtCeiling);
    if (debtCeiling > 0 && debtFloor > debtCeiling) {
      errors.push('Debt floor cannot be greater than debt ceiling');
    }

    return errors;
  }, [formData, hasScientificNotation]);

  const resetForm = useCallback(() => {
    setFormData(EMPTY_FORM_DATA);
    setEditingAsset(null);
  }, []);

  // Helper function to convert scientific notation to full integer string
  const convertScientificNotation = useCallback((value: string): string => {
    if (!value) return '';
    
    // Check if it's scientific notation
    if (value.includes('e+') || value.includes('e-') || value.includes('E+') || value.includes('E-')) {
      // Use BigInt to avoid scientific notation for large numbers
      const num = parseFloat(value);
      if (Number.isInteger(num)) {
        return BigInt(Math.floor(num)).toString();
      } else {
        // For non-integers, use toFixed(0) to avoid scientific notation
        return num.toFixed(0);
      }
    }
    
    return value;
  }, []);

  const handleSubmit = useCallback(async () => {
    const errors = validateForm();
    if (errors.length > 0) {
      toast.error(`Validation errors: ${errors.join(', ')}`);
      return;
    }

    try {
      setLoading(true);
      
      // Convert stabilityFeeRate from annual percentage back to RAY format
      // The backend converts RAY to annual percentage using:
      // (RAY_value - RAY) * 365 * 24 * 60 * 60 / RAY * 100
      // So we need to reverse this formula
      const RAY = BigInt(10) ** BigInt(27); // 10^27
      const annualRate = parseFloat(formData.stabilityFeeRate); // e.g., 1.9802625581975757
      
      // Convert annual percentage to per-second decimal rate
      const perSecondRate = annualRate / (365 * 24 * 60 * 60) / 100; // Convert to decimal per second
      
      // Convert to RAY format: RAY + (perSecondRate * RAY)
      const stabilityFeeRateRAY = (RAY + BigInt(Math.floor(perSecondRate * Number(RAY)))).toString();
      
      const configData = {
        asset: formData.asset,
        liquidationRatio: (BigInt(Math.floor(parseFloat(formData.liquidationRatio) * 1e18))).toString(),
        liquidationPenaltyBps: formData.liquidationPenaltyBps,
        closeFactorBps: formData.closeFactorBps,
        stabilityFeeRate: stabilityFeeRateRAY,
        debtFloor: (BigInt(Math.floor(parseFloat(formData.debtFloor) * 1e18))).toString(),
        debtCeiling: (BigInt(Math.floor(parseFloat(formData.debtCeiling) * 1e18))).toString(),
        unitScale: convertScientificNotation(formData.unitScale),
        isPaused: formData.isPaused,
      };

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
  }, [formData, validateForm, resetForm, loadAssets, convertScientificNotation]);

  const handleEditAsset = useCallback((asset: AssetConfig) => {
    setEditingAsset(asset.asset);
    setFormData({
      asset: asset.asset,
      liquidationRatio: (asset.liquidationRatio / 100).toString(),
      liquidationPenaltyBps: asset.liquidationPenaltyBps.toString(),
      closeFactorBps: asset.closeFactorBps.toString(),
      stabilityFeeRate: asset.stabilityFeeRate.toString(),
      debtFloor: (parseFloat(asset.debtFloor) / 1e18).toString(),
      debtCeiling: (parseFloat(asset.debtCeiling) / 1e18).toString(),
      unitScale: asset.unitScale,
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

  const formatValue = useCallback((value: string, type: 'percentage' | 'usd' | 'bps' | 'raw') => {
    switch (type) {
      case 'percentage':
        return `${(parseFloat(value) / 100).toFixed(2)}%`;
      case 'usd':
        return `$${(parseFloat(value) / 1e18).toFixed(2)}`;
      case 'bps':
        return `${(parseFloat(value) / 100).toFixed(2)}%`;
      case 'raw':
        return value;
      default:
        return value;
    }
  }, []);


  return (
    <div className="space-y-6">
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
                {/* Asset Address */}
                <div className="space-y-2">
                  <Label htmlFor="asset">Asset Address</Label>
                  <Input
                    id="asset"
                    placeholder="0x..."
                    value={formData.asset}
                    onChange={(e) => handleInputChange('asset', e.target.value)}
                    disabled={editingAsset !== null}
                  />
                </div>

                {/* Liquidation Ratio */}
                <div className="space-y-2">
                  <Label htmlFor="liquidationRatio">Liquidation Ratio (e.g., 1.5 = 150%)</Label>
                  <Input
                    id="liquidationRatio"
                    type="number"
                    step="0.1"
                    min="1.0"
                    placeholder="1.5"
                    value={formData.liquidationRatio}
                    onChange={(e) => handleInputChange('liquidationRatio', e.target.value)}
                  />
                </div>

                {/* Liquidation Penalty */}
                <div className="space-y-2">
                  <Label htmlFor="liquidationPenaltyBps">Liquidation Penalty (Basis Points)</Label>
                  <Input
                    id="liquidationPenaltyBps"
                    type="number"
                    min="500"
                    max="3000"
                    placeholder="1000"
                    value={formData.liquidationPenaltyBps}
                    onChange={(e) => handleInputChange('liquidationPenaltyBps', e.target.value)}
                  />
                  <p className="text-sm text-gray-500">500-3000 bps (5%-30%)</p>
                </div>

                {/* Close Factor */}
                <div className="space-y-2">
                  <Label htmlFor="closeFactorBps">Close Factor (Basis Points)</Label>
                  <Input
                    id="closeFactorBps"
                    type="number"
                    min="5000"
                    max="10000"
                    placeholder="5000"
                    value={formData.closeFactorBps}
                    onChange={(e) => handleInputChange('closeFactorBps', e.target.value)}
                  />
                  <p className="text-sm text-gray-500">5000-10000 bps (50%-100%)</p>
                </div>

                {/* Stability Fee Rate */}
                <div className="space-y-2">
                  <Label htmlFor="stabilityFeeRate">Stability Fee Rate (RAY)</Label>
                  <Input
                    id="stabilityFeeRate"
                    placeholder="1.0"
                    value={formData.stabilityFeeRate}
                    onChange={(e) => handleInputChange('stabilityFeeRate', e.target.value)}
                  />
                  <p className="text-sm text-gray-500">Per-second interest rate (minimum 1.0 = 0% interest)</p>
                </div>

                {/* Debt Floor */}
                <div className="space-y-2">
                  <Label htmlFor="debtFloor">Debt Floor (USD)</Label>
                  <Input
                    id="debtFloor"
                    type="number"
                    min="0"
                    placeholder="100"
                    value={formData.debtFloor}
                    onChange={(e) => handleInputChange('debtFloor', e.target.value)}
                  />
                </div>

                {/* Debt Ceiling */}
                <div className="space-y-2">
                  <Label htmlFor="debtCeiling">Debt Ceiling (USD)</Label>
                  <Input
                    id="debtCeiling"
                    type="text"
                    placeholder="Enter debt ceiling (e.g., 1000000 for $1M)"
                    value={formData.debtCeiling}
                    onChange={(e) => handleInputChange('debtCeiling', e.target.value)}
                  />
                  <p className="text-xs text-gray-500">
                    Enter the full number (e.g., 1000000 not 1e+6)
                  </p>
                </div>

                {/* Unit Scale */}
                <div className="space-y-2">
                  <Label htmlFor="unitScale">Unit Scale</Label>
                  <Input
                    id="unitScale"
                    type="text"
                    placeholder="Enter unit scale (e.g., 1000000000000000000 for 18 decimals)"
                    value={formData.unitScale}
                    onChange={(e) => handleInputChange('unitScale', e.target.value)}
                  />
                  <p className="text-xs text-gray-500">
                    Enter the full number (e.g., 1000000000000000000 not 1e+18)
                  </p>
                </div>

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
                  disabled={loading}
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
