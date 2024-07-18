import React, { useEffect, useState, useMemo } from "react";
import { useNavigate, useMatch, useLocation } from "react-router-dom";
import { Spin } from "antd";
// Actions
import { actions as orderActions } from "../../contexts/order/actions";
import { actions as marketplaceActions } from "../../contexts/marketplace/actions";
// Dispatch and States
import { useOrderDispatch, useOrderState } from "../../contexts/order";
import { useMarketplaceDispatch } from "../../contexts/marketplace";
// Components
import { showToast } from "../Notification/ToastComponent";
// Other
import routes from "../../helpers/routes";

function useQuery() {
  const { search } = useLocation();
  return useMemo(() => new URLSearchParams(search), [search]);
}

const ProcessingOrder = ({ user }) => {
  const navigate = useNavigate();
  // Dispatch
  const marketplaceDispatch = useMarketplaceDispatch();
  const orderDispatch = useOrderDispatch();
  // States
  const { message, success } = useOrderState();
  // useStates
  const [assetAddresses, setAssetAddresses] = useState([]);
  const [error, setError] = useState(null)
  const [called, setCalled] = useState(false);


  const storedData = useMemo(() => {
    return JSON.parse(window.localStorage.getItem("cartList") ?? []);
  }, []);

  const routeMatch = useMatch({
    path: routes.ProcessingOrder.url,
    strict: true,
  });

  const query = useQuery();

  useEffect(() => {
    setAssetAddresses(query.get("assets"));
  }, [routeMatch, query]);

  useEffect(() => {
    if (assetAddresses !== undefined && user !== undefined && !called) {
      setCalled(true);
      getCartData();
    }
  }, [assetAddresses, user]);

  useEffect(() => {
    const errorMsg = query.get("error");
    if (errorMsg) {
      setError(new Error(errorMsg));
    }
  }, [query]);

  const getCartData = async () => {
    try {
      if (assetAddresses) {
        let updatedCart = [];
        storedData.forEach(cart => {
          if (!assetAddresses.includes(cart.product.address)) {
            updatedCart.push(cart);
          }
        });
        marketplaceActions.addItemToCart(marketplaceDispatch, updatedCart);
        setTimeout(() => {
          navigate(routes.Orders.url.replace(':type', 'bought'));
        }, 500);
      } else {
        setTimeout(() => {
          navigate(routes.Checkout.url);
        }, 3000);
      }
    } catch (err) {
      setError(err);
    }
  }

  return (
    <div>
      <div className="h-96 flex flex-col justify-center items-center">
        <Spin spinning={true} size="large" />
        <p className="mt-4">Please wait while your order is being processed</p>
      </div>
      {error && showToast({
        message: error.message,
        onClose: setError(null),
        success: false,
        placement: 'bottom',
      })}
      {message && showToast({
        message: message,
        onClose: orderActions.resetMessage(orderDispatch),
        success: success,
        placement: 'bottom',
      })}
    </div>
  );
};

export default ProcessingOrder;
