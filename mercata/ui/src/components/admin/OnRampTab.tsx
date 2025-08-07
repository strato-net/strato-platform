import { useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import AddPaymentProviderForm from './AddPaymentProviderForm';
import PaymentProvidersTable from './PaymentProvidersTable';
import OnRampListingsTable from './OnRampListingsTable';
import ListAssetForm from './ListAssetForm';

const OnRampTab = () => {
  const paymentProvidersTableRef = useRef<{ refresh: () => void }>(null);
  const onRampListingsTableRef = useRef<{ refresh: () => void }>(null);
  
  const handleProvidersUpdate = useCallback(() => {
    paymentProvidersTableRef.current?.refresh();
  }, []);
  
  const handleListingsUpdate = useCallback(() => {
    onRampListingsTableRef.current?.refresh();
  }, []);
  return (
    <div className="space-y-6">
      {/* First Row - Configuration Forms */}
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
              <AddPaymentProviderForm onSuccess={handleProvidersUpdate} />
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

      {/* Second Row - Lists */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-0">
        {/* Payment Providers List */}
        <div className="bg-card border-r border-t border-l border-b lg:border-r-0 rounded-l-lg p-6">
          <PaymentProvidersTable ref={paymentProvidersTableRef} />
        </div>
        
        {/* OnRamp Listings List */}
        <div className="bg-card border-r border-t border-b rounded-r-lg p-6">
          <OnRampListingsTable ref={onRampListingsTableRef} />
        </div>
      </div>
    </div>
  );
};

export default OnRampTab;