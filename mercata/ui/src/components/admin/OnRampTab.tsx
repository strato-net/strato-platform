import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import AddPaymentProviderForm from './AddPaymentProviderForm';
import PaymentProvidersTable from './PaymentProvidersTable';
import OnRampListingsTable from './OnRampListingsTable';
import ListAssetForm from './ListAssetForm';

const OnRampTab = () => {
  return (
    <div className="space-y-6">
      {/* First Row - Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
        {/* Payment Providers List */}
        <div className="bg-card border-r border-t border-l border-b lg:border-r-0 rounded-l-lg p-6">
          <PaymentProvidersTable />
        </div>
        
        {/* OnRamp Listings List */}
        <div className="bg-card border-r border-t border-b rounded-r-lg p-6">
          <OnRampListingsTable />
        </div>
      </div>

      {/* Second Row - Configuration Forms */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
        {/* Add Payment Provider Form */}
        <div className="bg-card border-r border-t border-l border-b lg:border-r-0 rounded-l-lg p-6">
          <Card className="border-0">
            <CardHeader>
              <CardTitle>Add Payment Provider</CardTitle>
              <CardDescription>
                Configure new payment providers for fiat-to-crypto transactions
              </CardDescription>
            </CardHeader>
            <CardContent>
              <AddPaymentProviderForm />
            </CardContent>
          </Card>
        </div>
        
        {/* List Assets Form */}
        <div className="bg-card border-r border-t border-b rounded-r-lg p-6">
          <Card className="border-0">
            <CardHeader>
              <CardTitle>List Assets for Sale</CardTitle>
              <CardDescription>
                List tokens for direct purchase with fiat using configured payment providers
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ListAssetForm />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default OnRampTab;