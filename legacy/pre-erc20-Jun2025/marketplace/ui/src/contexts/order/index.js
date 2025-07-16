import React, { createContext, useContext, useReducer } from 'react';
import reducer from './reducer';

const OrderStateContext = createContext();
const OrderDispatchContext = createContext();

const OrdersProvider = ({ children }) => {
  const initialState = {
    order: null,
    isCreateOrderSubmitting: false,
    payment: null,
    isCreatePaymentSubmitting: false,
    orders: [],
    orderSoldTotal: 10,
    orderBoughtTotal: 10,
    isordersLoading: false,
    ordersSold: [],
    isordersSoldLoading: false,
    orderDetails: null,
    isorderDetailsLoading: false,
    orderUpdateObject: null,
    isorderUpdating: false,
    error: undefined,
    success: false,
    message: null,
    isbuyerDetailsUpdating: false,
    buyerUpdateObject: null,
    issellerDetailsUpdating: false,
    sellerUpdateObject: null,
    isCreateOrderLineItem: false,
    item: null,
    orderLineDetails: null,
    isOrderLineDetailsLoading: false,
    isUpdatingOrderComment: false,
    allOrders: {},
    isAllOrdersLoading: false,
    saleQuantity: [],
    saleQuantityLoading: false,
    isOrderEventLoading: true,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <OrderStateContext.Provider value={state}>
      <OrderDispatchContext.Provider value={dispatch}>
        {children}
      </OrderDispatchContext.Provider>
    </OrderStateContext.Provider>
  );
};

const useOrderState = () => {
  const context = useContext(OrderStateContext);
  if (context === undefined) {
    throw new Error(`'useOrderState' must be used within a OrdersProvider`);
  }
  return context;
};

const useOrderDispatch = () => {
  const context = useContext(OrderDispatchContext);
  if (context === undefined) {
    throw new Error(`'useOrderDispatch' must be used within a OrdersProvider`);
  }
  return context;
};

const useOrderUnit = () => {
  return [useOrderState(), useOrderDispatch()];
};

export { useOrderDispatch, useOrderState, useOrderUnit, OrdersProvider };
