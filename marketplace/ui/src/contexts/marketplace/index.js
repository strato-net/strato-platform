import React, { createContext, useContext, useReducer } from "react";
import reducer from "./reducer";

const MarketplaceStateContext = createContext();
const MarketplaceDispatchContext = createContext();

const MarketplaceProvider = ({ children }) => {
  const initialState = {
    marketplaceList: [],
    isMarketplaceLoading: false,
    isMarketplaceInitialLoading: true,
    isTopSellingProductsLoading: false,
    topSellingProducts: [],
    isAddingShippingAddress: false,
    shippingAddress: null,
    error: undefined,
    success: false,
    message: null,
    cartList: [],
    confirmOrderList: [],
    userAddress: null,
    isLoadingUserAddress: false,
    userAddresses: [],
    isLoadingUserAddresses: false,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <MarketplaceStateContext.Provider value={state}>
      <MarketplaceDispatchContext.Provider value={dispatch}>
        {children}
      </MarketplaceDispatchContext.Provider>
    </MarketplaceStateContext.Provider>
  );
};

const useMarketplaceState = () => {
  const context = useContext(MarketplaceStateContext);
  if (context === undefined) {
    throw new Error(
      `'useMarketplaceState' must be used within a MarketplaceProvider`
    );
  }
  return context;
};

const useMarketplaceDispatch = () => {
  const context = useContext(MarketplaceDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'useMarketplaceDispatch' must be used within a MarketplacesProvider`
    );
  }
  return context;
};

const useMarketplaceUnit = () => {
  return [useMarketplaceState(), useMarketplaceDispatch()];
};

export {
  useMarketplaceDispatch,
  useMarketplaceState,
  useMarketplaceUnit,
  MarketplaceProvider,
};
