import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Plus, Settings, AlertTriangle, Pause, Play, Edit, Save, X, Loader2
} from 'lucide-react';
import { cdpService, AssetConfig } from '@/services/cdpService';
import { toast } from 'sonner';
import { Form, Input, Switch, Button as AntButton } from 'antd';
import { ExclamationCircleOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { handleRecipientAddress, handleAdminNumericInputChange } from '@/utils/transferValidation';

const CollateralConfigManager = () => {
  const [form] = Form.useForm();
  const [activeTab, setActiveTab] = useState('add');
  const [assets, setAssets] = useState<AssetConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [editingAsset, setEditingAsset] = useState<string | null>(null);
  const [globalPaused, setGlobalPaused] = useState<boolean>(false);

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

  const resetForm = useCallback(() => {
    form.resetFields();
    setEditingAsset(null);
    setInputErrors({});
  }, [form]);

 

  const handleSubmit = useCallback(async (values: any) => {
    try {
      setLoading(true);
      
      // Convert UI values to contract format
      const WAD = BigInt(10) ** BigInt(18);
      const RAY = BigInt(10) ** BigInt(27);
      const secondsPerYear = BigInt(365 * 24 * 60 * 60);
      
      // Convert liquidation ratio from percentage to WAD (e.g., 150% -> 1.5e18)
      const liquidationRatioContract = (BigInt(Math.floor(Number(values.liquidationRatio) * 100)) * WAD) / BigInt(100);
      
      // Convert stability fee rate from annual percentage to per-second RAY
      const [intPart, decPart = ''] = values.stabilityFeeRate.toString().split('.');
      const scale = BigInt(10) ** BigInt(decPart.length);
      const stabilityFeeRateContract = (BigInt(intPart + decPart) * RAY) / (BigInt(100) * scale * secondsPerYear) + RAY;
      
      // Convert unit scale from decimal count to 1eX format
      const unitScaleContract = BigInt(10) ** BigInt(values.unitScale);

      // Convert debt floor/ceiling from USD to wei (18 decimals)
      // Convert to BigInt first, then multiply to avoid precision loss
      const debtFloorContract = BigInt(Math.floor(Number(values.debtFloor))) * (BigInt(10) ** BigInt(18));
      const debtCeilingContract = BigInt(Math.floor(Number(values.debtCeiling))) * (BigInt(10) ** BigInt(18));
      
      const configData = {
        asset: values.asset,
        liquidationRatio: liquidationRatioContract.toString(),
        liquidationPenaltyBps: values.liquidationPenaltyBps,
        closeFactorBps: values.closeFactorBps,
        stabilityFeeRate: stabilityFeeRateContract.toString(),
        debtFloor: debtFloorContract.toString(),
        debtCeiling: debtCeilingContract.toString(),
        unitScale: unitScaleContract.toString(),
        isPaused: values.isPaused ?? false
      };
      
      
      await cdpService.setCollateralConfig(configData);
      toast.success('Collateral configuration updated successfully');
      resetForm();
      await loadAssets();
    } finally {
      setLoading(false);
    }
  }, [ resetForm, loadAssets]);

  const handleEditAsset = useCallback((asset: AssetConfig) => {
    setEditingAsset(asset.asset);
    
    // Convert debt floor/ceiling from wei back to USD
    const debtFloorUI = (BigInt(asset.debtFloor) / (BigInt(10) ** BigInt(18)));
    const debtCeilingUI = (BigInt(asset.debtCeiling) / (BigInt(10) ** BigInt(18)));
    
    // Convert unit scale from 1eX back to decimal count
    const unitScaleUI = Math.log10(Number(asset.unitScale));
    
    form.setFieldsValue({
      asset: asset.asset.trim(),
      liquidationRatio: (asset.liquidationRatio / 100).toString(), // Convert percentage to decimal for form
      liquidationPenaltyBps: asset.liquidationPenaltyBps.toString(),
      closeFactorBps: asset.closeFactorBps.toString(),
      stabilityFeeRate: asset.stabilityFeeRate.toString(), // Backend already provides annual percentage
      debtFloor: debtFloorUI.toString(),
      debtCeiling: debtCeilingUI.toString(),
      unitScale: unitScaleUI.toString(),
      isPaused: asset.isPaused,
    });
    setActiveTab('add');
  }, [form]);

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
      case 'percentage': return `${num.toFixed(2)}%`;
      case 'usd': return `$${(num / 1e18).toFixed(2)}`;
      case 'bps': return `${(num / 100).toFixed(2)}%`;
      default: return value;
    }
  }, []);

  const [inputErrors, setInputErrors] = useState<Record<string, string>>({});

  const handleNumericInputChange = useCallback((field: string, value: string, maxValue: string = "999999999999999999999999999", decimals: number = 18, minValue: string = "0") => {
    const setError = (error: string) => {
      setInputErrors(prev => ({ ...prev, [field]: error }));
    };
    
    handleAdminNumericInputChange(
      value,
      (formattedValue) => form.setFieldValue(field, formattedValue),
      setError,
      maxValue,
      decimals,
      minValue
    );
  }, [form]);



  return (
    <div className="space-y-6">
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
              <span className="text-red-600 font-medium flex items-center space-x-2">
                <ExclamationCircleOutlined />
                <span>CDP system is paused - All operations are blocked</span>
              </span>
            ) : (
              <span className="text-green-600 font-medium flex items-center space-x-2">
                <CheckCircleOutlined />
                <span>CDP system is active - All operations are allowed</span>
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
              <Form
                form={form}
                layout="vertical"
                onFinish={handleSubmit}
                className="space-y-6"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <Form.Item
                    name="asset"
                    label="Asset Address"
                    // rules={formRules.asset}
                    validateStatus={inputErrors.asset ? 'error' : ''}
                    help={inputErrors.asset}
                  >
                    <Input 
                      placeholder="0x..." 
                      disabled={editingAsset !== null}
                      className="w-full"
                      onChange={(e) => handleRecipientAddress(
                        e,
                        (value) => form.setFieldValue('asset', value),
                        (error: string) => setInputErrors(prev => ({ ...prev, asset: error }))
                      )}
                    />
                  </Form.Item>

                  <Form.Item
                    name="liquidationRatio"
                    label="Liquidation Ratio (e.g., 1.5 = 150%)"
                    extra="Range: 1.0-5.0 (100%-500%)"
                    // rules={formRules.liquidationRatio}
                    validateStatus={inputErrors.liquidationRatio ? 'error' : ''}
                    help={inputErrors.liquidationRatio}
                  >
                    <Input 
                      placeholder="1.5"
                      className="w-full"
                      inputMode="decimal"
                      onChange={(e) => handleNumericInputChange('liquidationRatio', e.target.value, "5", 2, "1")}
                    />
                  </Form.Item>

                  <Form.Item
                    name="liquidationPenaltyBps"
                    label="Liquidation Penalty (Basis Points)"
                    // rules={formRules.liquidationPenaltyBps}
                    extra="Range: 500-3000 bps (5%-30%)"
                    validateStatus={inputErrors.liquidationPenaltyBps ? 'error' : ''}
                    help={inputErrors.liquidationPenaltyBps}
                  >
                    <Input 
                      placeholder="1000"
                      className="w-full"
                      inputMode="numeric"
                      onChange={(e) => handleNumericInputChange('liquidationPenaltyBps', e.target.value, "3000", 0, "500")}
                    />
                  </Form.Item>

                  <Form.Item
                    name="closeFactorBps"
                    label="Close Factor (Basis Points)"
                    // rules={formRules.closeFactorBps}
                    extra="Range: 5000-10000 bps (50%-100%)"
                    validateStatus={inputErrors.closeFactorBps ? 'error' : ''}
                    help={inputErrors.closeFactorBps}
                  >
                    <Input 
                      placeholder="5000"
                      className="w-full"
                      inputMode="numeric"
                      onChange={(e) => handleNumericInputChange('closeFactorBps', e.target.value, "10000", 0, "5000")}
                    />
                  </Form.Item>

                  <Form.Item
                    name="stabilityFeeRate"
                    label="Stability Fee Rate (RAY)"
                    // rules={formRules.stabilityFeeRate}
                    extra="Range: 0-100% annual rate (0% = 1.0 RAY minimum)"
                    validateStatus={inputErrors.stabilityFeeRate ? 'error' : ''}
                    help={inputErrors.stabilityFeeRate}
                  >
                    <Input 
                      placeholder="1.0"
                      className="w-full"
                      inputMode="decimal"
                      onChange={(e) => handleNumericInputChange('stabilityFeeRate', e.target.value, "100", 18, "0")}
                    />
                  </Form.Item>

                  <Form.Item
                    name="debtFloor"
                    label="Debt Floor (USD)"
                    extra="Range: 0+ USD (2 decimal places)"
                    // rules={[...formRules.debtFloor, { validator: validateDebtFloor }]}
                    validateStatus={inputErrors.debtFloor ? 'error' : ''}
                    help={inputErrors.debtFloor}
                  >
                    <Input 
                      placeholder="100"
                      className="w-full"
                      inputMode="decimal"
                      onChange={(e) => handleNumericInputChange('debtFloor', e.target.value, "1000000", 2, "0")}
                    />
                  </Form.Item>

                  <Form.Item
                    name="debtCeiling"
                    label="Debt Ceiling (USD)"
                    // rules={[...formRules.debtCeiling, { validator: validateDebtCeiling }]}
                    extra="Range: 0+ USD (2 decimal places)"
                    validateStatus={inputErrors.debtCeiling ? 'error' : ''}
                    help={inputErrors.debtCeiling}
                  >
                    <Input 
                      placeholder="Enter debt ceiling (e.g., 1000000 for $1M)"
                      className="w-full"
                      inputMode="decimal"
                      onChange={(e) => handleNumericInputChange('debtCeiling', e.target.value, "1000000000", 2, "0")}
                    />
                  </Form.Item>

                  <Form.Item
                    name="unitScale"
                    label="Token Decimals"
                    // rules={formRules.unitScale}
                    extra="Range: 0-18 (decimal places, e.g., 18 for standard ERC20)"
                    validateStatus={inputErrors.unitScale ? 'error' : ''}
                    help={inputErrors.unitScale}
                  >
                    <Input 
                      placeholder="Enter decimal places (e.g., 18 for standard ERC20)"
                      className="w-full"
                      inputMode="numeric"
                      onChange={(e) => handleNumericInputChange('unitScale', e.target.value, "18", 0, "0")}
                    />
                  </Form.Item>

                  {/* Pause Status */}
                  <Form.Item
                    name="isPaused"
                    label="Pause Asset"
                    valuePropName="checked"
                  >
                    <Switch />
                  </Form.Item>
                </div>

                <div className="flex items-center space-x-4">
                  <AntButton 
                    htmlType="submit"
                    disabled={loading}
                    className="flex items-center space-x-2"
                    type="primary"
                  >
                    {loading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    <span>{editingAsset ? 'Update Config' : 'Add Config'}</span>
                  </AntButton>
                  
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
              </Form>
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