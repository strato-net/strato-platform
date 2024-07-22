import React, { useState, useEffect } from 'react';
import { PDFViewer } from '@react-pdf/renderer';
import { useMatch } from "react-router-dom";
import { Spin } from "antd";
// Actions
import { actions as orderActions } from "../../contexts/order/actions";
// Dispatch and States
import { useOrderDispatch, useOrderState } from "../../contexts/order";
// Components
import InvoiceComponent from './InvoiceComponent';
// Other
import routes from "../../helpers/routes";


const Invoice = () => {
  // Dispatch
  const dispatch = useOrderDispatch();
  // States
  const { orderDetails, isorderDetailsLoading } = useOrderState();
  // useStates
  const [Id, setId] = useState(undefined);

  const routeMatch = useMatch({
    path: routes.Invoice.url,
    strict: true,
  });

  useEffect(() => {
    setId(routeMatch?.params?.id);
  }, [routeMatch]);

  useEffect(() => {
    if (Id !== undefined ) {
      orderActions.fetchOrderDetails(dispatch, Id);
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
