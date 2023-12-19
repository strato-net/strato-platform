import React, { useState, useEffect } from 'react';
import { PDFViewer } from '@react-pdf/renderer';
import InvoiceComponent from './InvoiceComponent';
import { actions } from "../../contexts/order/actions";
import { useOrderDispatch, useOrderState } from "../../contexts/order";
import { actions as marketplaceActions } from "../../contexts/marketplace/actions";
import { useMarketplaceDispatch, useMarketplaceState } from "../../contexts/marketplace";
import routes from "../../helpers/routes";
import { useMatch } from "react-router-dom";
import { Spin } from "antd";


const Invoice = () => {
  const [Id, setId] = useState(undefined);
  const marketplaceDispatch = useMarketplaceDispatch();

  const dispatch = useOrderDispatch();
  const {
    orderDetails,
    isorderDetailsLoading,
  } = useOrderState();

  const {
    userAddress,
    isLoadingUserAddress,
  } = useMarketplaceState();

  const routeMatch = useMatch({
    path: routes.Invoice.url,
    strict: true,
  });


  useEffect(() => {
    setId(routeMatch?.params?.id);
  }, [routeMatch]);

  useEffect(() => {
    if (Id !== undefined ) {
      actions.fetchOrderDetails(dispatch, Id);
    }
  }, [Id, dispatch]);

  useEffect(() => {
    if (orderDetails) {
      console.log(orderDetails);
      marketplaceActions.fetchUserAddress(marketplaceDispatch, orderDetails.order.shippingAddressId);
    }
  }, [orderDetails]);



  return (
    <div className='h-screen'>
      {orderDetails === null || isorderDetailsLoading || userAddress === null || isLoadingUserAddress ? (
        <div className="h-screen flex justify-center items-center">
          <Spin
            spinning={isorderDetailsLoading || isLoadingUserAddress}
            size="large"
          />
        </div>
      ) :
        <PDFViewer  style={{ width: '100%', height: '90%' }}>
          <InvoiceComponent invoice={orderDetails} userAddress={userAddress}/>
        </PDFViewer>
      }
    </div>
  );
};

export default Invoice;
