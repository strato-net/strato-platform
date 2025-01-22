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
  const { assetsWithEighteenDecimalPlaces, isFetchingAssetsWithEighteenDecimalPlaces } = useMarketplaceState();
  const [is18DecimalPlaces, setIs18DecimalPlaces] = useState(false);

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
      marketplaceActions.fetchAssetsWithEighteenDecimalPlaces(
        marketplaceDispatch
      );
    }
  }, [Id, dispatch]);

  useEffect(() => {
    if (orderDetails && assetsWithEighteenDecimalPlaces) {
      const is18DecimalPlaces = assetsWithEighteenDecimalPlaces.includes(
        orderDetails.assets[0].root
      );
      setIs18DecimalPlaces(is18DecimalPlaces);
    }
  }, [orderDetails, assetsWithEighteenDecimalPlaces]);

  return (
    <div className="h-screen">
      {orderDetails === null || isorderDetailsLoading || isFetchingAssetsWithEighteenDecimalPlaces ? (
        <div className="h-screen flex justify-center items-center">
          <Spin spinning={isorderDetailsLoading} size="large" />
        </div>
      ) : (
        <PDFViewer style={{ width: '100%', height: '90%' }}>
          <InvoiceComponent
            invoice={orderDetails}
            is18DecimalPlaces={is18DecimalPlaces}
          />
        </PDFViewer>
      )}
    </div>
  );
};

export default Invoice;
