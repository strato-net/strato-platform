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
  }, [form]);

 

  const handleSubmit = useCallback(async (values: any) => {
    try {
      setLoading(true);
      const configData = {
        ...values,
        isPaused: values.isPaused ?? false  // Default to false if undefined
      };     
      console.log("configData CDPPPP", configData);
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
  }, [ resetForm, loadAssets]);

  const handleEditAsset = useCallback((asset: AssetConfig) => {
    setEditingAsset(asset.asset);
    form.setFieldsValue({
      asset: asset.asset.trim(),
      // Convert liquidation ratio from percentage back to decimal format
      liquidationRatio: asset.liquidationRatio,
      liquidationPenaltyBps: asset.liquidationPenaltyBps,
      closeFactorBps: asset.closeFactorBps,
      // Convert stability fee rate from RAY back to annual percentage
      stabilityFeeRate: asset.stabilityFeeRate,
      // Convert USD amounts from wei back to decimal format
      debtFloor:asset.debtFloor ,
      debtCeiling:asset.debtCeiling,
      // Convert unit scale from wei back to decimal format
      unitScale:asset.unitScale,
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
      case 'percentage': return `${(num / 100).toFixed(2)}%`;
      case 'usd': return `$${(num / 1e18).toFixed(2)}`;
      case 'bps': return `${(num / 100).toFixed(2)}%`;
      default: return value;
    }
  }, []);


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
                  >
                    <Input 
                      placeholder="0x..." 
                      disabled={editingAsset !== null}
                      className="w-full"
                    />
                  </Form.Item>

                  <Form.Item
                    name="liquidationRatio"
                    label="Liquidation Ratio (e.g., 1.5 = 150%)"
                    // rules={formRules.liquidationRatio}
                  >
                    <Input 
                      placeholder="1.5"
                      className="w-full"
                    />
                  </Form.Item>

                  <Form.Item
                    name="liquidationPenaltyBps"
                    label="Liquidation Penalty (Basis Points)"
                    // rules={formRules.liquidationPenaltyBps}
                    extra="500-3000 bps (5%-30%)"
                  >
                    <Input 
                      placeholder="1000"
                      className="w-full"
                    />
                  </Form.Item>

                  <Form.Item
                    name="closeFactorBps"
                    label="Close Factor (Basis Points)"
                    // rules={formRules.closeFactorBps}
                    extra="5000-10000 bps (50%-100%)"
                  >
                    <Input 
                      placeholder="5000"
                      className="w-full"
                    />
                  </Form.Item>

                  <Form.Item
                    name="stabilityFeeRate"
                    label="Stability Fee Rate (RAY)"
                    // rules={formRules.stabilityFeeRate}
                    extra="Per-second interest rate (minimum 1.0 = 0% interest)"
                  >
                    <Input 
                      placeholder="1.0"
                      className="w-full"
                    />
                  </Form.Item>

                  <Form.Item
                    name="debtFloor"
                    label="Debt Floor (USD)"
                    // rules={[...formRules.debtFloor, { validator: validateDebtFloor }]}
                  >
                    <Input 
                      placeholder="100"
                      className="w-full"
                    />
                  </Form.Item>

                  <Form.Item
                    name="debtCeiling"
                    label="Debt Ceiling (USD)"
                    // rules={[...formRules.debtCeiling, { validator: validateDebtCeiling }]}
                    extra="Enter the full number (e.g., 1000000 not 1e+6)"
                  >
                    <Input 
                      placeholder="Enter debt ceiling (e.g., 1000000 for $1M)"
                      className="w-full"
                    />
                  </Form.Item>

                  <Form.Item
                    name="unitScale"
                    label="Unit Scale"
                    // rules={formRules.unitScale}
                    extra="Enter decimal value (e.g., 1 for 18 decimals, 0.001 for 15 decimals)"
                  >
                    <Input 
                      placeholder="Enter unit scale (e.g., 1 for 18 decimals)"
                      className="w-full"
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