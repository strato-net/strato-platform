import React, { useState, useEffect } from 'react';
import { PDFViewer } from '@react-pdf/renderer';
import InvoiceComponent from './InvoiceComponent';
import { actions } from '../../contexts/order/actions';
import { actions as marketplaceActions } from '../../contexts/marketplace/actions';
import { useOrderDispatch, useOrderState } from '../../contexts/order';
import {
  useMarketplaceState,
  useMarketplaceDispatch,
} from '../../contexts/marketplace';
import routes from '../../helpers/routes';
import { useMatch } from 'react-router-dom';
import { Spin } from 'antd';

const Invoice = () => {
  const [Id, setId] = useState(undefined);
  const dispatch = useOrderDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();
  const { orderDetails, isorderDetailsLoading } = useOrderState();
  const [decimals, setDecimals] = useState(false);

  const routeMatch = useMatch({
    path: routes.Invoice.url,
    strict: true,
  });

  useEffect(() => {
    setId(routeMatch?.params?.id);
  }, [routeMatch]);

  useEffect(() => {
    if (Id !== undefined) {
      actions.fetchOrderDetails(dispatch, Id);
    }
  }, [Id, dispatch]);

  useEffect(() => {
    if (orderDetails) {
      const decimals = 18;
      setDecimals(decimals);
    }
  }, [orderDetails]);

  return (
    <div className="h-screen">
      {orderDetails === null || isorderDetailsLoading ? (
        <div className="h-screen flex justify-center items-center">
          <Spin spinning={isorderDetailsLoading} size="large" />
        </div>
      ) : (
        <PDFViewer style={{ width: '100%', height: '90%' }}>
          <InvoiceComponent
            invoice={orderDetails}
            decimals={decimals}
          />
        </PDFViewer>
      )}
    </div>
  );
};

export default Invoice;
