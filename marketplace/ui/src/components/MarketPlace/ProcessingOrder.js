import { Spin, notification } from "antd";
import React, { useEffect, useState, useMemo } from "react";
import { useNavigate, useMatch, useLocation } from "react-router-dom";
import routes from "../../helpers/routes";
import { actions as orderActions } from "../../contexts/order/actions";
import { useOrderDispatch, useOrderState } from "../../contexts/order";
import { actions } from "../../contexts/marketplace/actions";
import { useMarketplaceDispatch, useMarketplaceState } from "../../contexts/marketplace";

function useQuery() {
  const { search } = useLocation();

  return useMemo(() => new URLSearchParams(search), [search]);
}

const ProcessingOrder = ({ user }) => {

  const navigate = useNavigate();
  const [assetAddresses, setAssetAddresses] = useState([]);
  const orderDispatch = useOrderDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();
  const [error, setError] = useState(null)
  const { message, success, isOrderEventLoading } = useOrderState();
  const [api, contextHolder] = notification.useNotification();
  const [called, setCalled] = useState(false);
  const { cartList } = useMarketplaceState();
  const [orderHash, setOrderHash] = useState("");

  // const storedData = useMemo(() => {
  //   return JSON.parse(window.localStorage.getItem("cartList") ?? []);
  // }, []);

  const storedConfirmList = useMemo(() => {
    return JSON.parse(window.localStorage.getItem("confirmOrderList") ?? []);
  }, []);

  const routeMatch = useMatch({
    path: routes.ProcessingOrder.url,
    strict: true,
  });

  const query = useQuery();

  useEffect(() => {
    setAssetAddresses(query.get("assets"));
    setOrderHash(query.get("orderHash"));
  }, [routeMatch, query]);
  
  useEffect(() => {
    if (orderHash) {
      orderActions.waitForOrderEvent(orderDispatch, orderHash);
    }
  }, [orderHash]);
  
  useEffect(() => {
    if (assetAddresses !== undefined && user !== undefined && !called) {
      setCalled(true);
    }
  }, [assetAddresses, user, called]);
  
  useEffect(() => {
    const errorMsg = query.get("error");
    if (errorMsg) {
      setError(new Error(errorMsg));
    }
  }, [query]);
  
  useEffect(() => {
    // Trigger getCartData when isOrderEventLoading changes to false
    if (!isOrderEventLoading && called) {
      getCartData();
    }
  }, [isOrderEventLoading, called]);
  
  const getCartData = async () => {
    try {
      if (orderHash) {
        let updatedCart = [];
        storedConfirmList.forEach(cart => {
          if (!assetAddresses.includes(cart.action)) {
            updatedCart.push(cart);
          }
        });
        actions.addItemToCart(marketplaceDispatch, updatedCart);
  
        // Navigate to transaction once the cart is updated
        navigate(routes.Transactions.url);
      } else {
        setTimeout(() => {
          navigate(routes.Checkout.url);
        }, 3000);
      }
    } catch (err) {
      setError(err);
    }
  };
  
  const openToastMarketplace = (placement) => {
    if (error != null) {
      api.error({
        message: error.message,
        onClose: setError(null),
        placement,
        key: 2,
      });
    }
  };

  const openToastOrder = (placement) => {
    if (success) {
      api.success({
        message: message,
        onClose: orderActions.resetMessage(orderDispatch),
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: message,
        onClose: orderActions.resetMessage(orderDispatch),
        placement,
        key: 2,
      });
    }
  };



  return (
    <div>
      {contextHolder}
      <div className="h-96 flex flex-col justify-center items-center">
        <Spin spinning={true} size="large" />
        <p className="mt-4">Please wait while your order is being processed</p>
      </div>
      {error && openToastMarketplace("bottom")}
      {message && openToastOrder("bottom")}
    </div>
  );
};

export default ProcessingOrder;
