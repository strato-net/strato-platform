import React, { createContext, useContext, useReducer } from "react";
import reducer from "./reducer";

const OrderLineItemStateContext = createContext();
const OrderLineItemDispatchContext = createContext();

const OrderLineItemsProvider = ({ children }) => {
  const initialState = {
    orderLineItem: null,
    isCreateOrderLineItemSubmitting: false,
    orderLineItems: [],
    isorderLineItemsLoading: false,
    orderLineItemDetails: null,
    isorderLineItemDetailsLoading: false,
    orderLineItemOwnership: null,
    isOwnershiporderLineItemTransferring: false,
    orderLineItemUpdateObject: null,
    isorderLineItemUpdating: false,
    orderLineItemsAudit: [],
    isorderLineItemsAuditLoading: false,
    error: undefined,
    success: false,
    message: null,
    isAssetImportInProgress: false,
    assetsUploaded: 0,
    assetsUploadedErrors: [],
    isImportAssetsModalOpen: false
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <OrderLineItemStateContext.Provider value={state}>
      <OrderLineItemDispatchContext.Provider value={dispatch}>
        {children}
      </OrderLineItemDispatchContext.Provider>
    </OrderLineItemStateContext.Provider>
  );
};

const useOrderLineItemState = () => {
  const context = useContext(OrderLineItemStateContext);
  if (context === undefined) {
    throw new Error(
      `'useOrderLineItemState' must be used within a OrderLineItemsProvider`
    );
  }
  return context;
};

const useOrderLineItemDispatch = () => {
  const context = useContext(OrderLineItemDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'useOrderLineItemDispatch' must be used within a OrderLineItemsProvider`
    );
  }
  return context;
};

const useOrderLineItemUnit = () => {
  return [useOrderLineItemState(), useOrderLineItemDispatch()];
};

export {
  useOrderLineItemDispatch,
  useOrderLineItemState,
  useOrderLineItemUnit,
  OrderLineItemsProvider,
};
