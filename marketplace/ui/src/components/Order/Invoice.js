import React, { useState, useMemo, useEffect } from 'react';
import { PDFViewer } from '@react-pdf/renderer';
import InvoiceComponent from './InvoiceComponent';
import { actions } from "../../contexts/order/actions";
import { useOrderDispatch, useOrderState } from "../../contexts/order";
import routes from "../../helpers/routes";
import { useMatch, useLocation } from "react-router-dom";
import { Spin } from "antd";
import data from "./invoice.json";

function useQuery() {
  const { search } = useLocation();

  return useMemo(() => new URLSearchParams(search), [search]);
}

const Invoice = () => {
  const [Id, setId] = useState(undefined);
  const [chainId, setChainId] = useState(undefined);

  const dispatch = useOrderDispatch();
  const {
    orderDetails,
    isorderDetailsLoading,
  } = useOrderState();


  const routeMatch = useMatch({
    path: routes.Invoice.url,
    strict: true,
  });

  const query = useQuery();

  useEffect(() => {
    setId(routeMatch?.params?.id);
    setChainId(query.get("chainId"));
  }, [routeMatch]);

  useEffect(() => {
    if (Id !== undefined && chainId !== undefined) {
      actions.fetchOrderDetails(dispatch, Id, chainId);
      // actions.fetchOrderAudit(dispatch, Id, chainId);
    }
  }, [Id, dispatch]);



  return (
    <div className='h-screen'>
      {orderDetails === null || isorderDetailsLoading ? (
        <div className="h-screen flex justify-center items-center">
          <Spin
            spinning={isorderDetailsLoading}
            size="large"
          />
        </div>
      ) :
        <PDFViewer  style={{ width: '100%', height: '90%' }}>
          <InvoiceComponent invoice={orderDetails} />
        </PDFViewer>
      }
    </div>
  );
};

export default Invoice;
