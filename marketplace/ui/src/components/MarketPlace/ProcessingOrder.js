import { Spin, notification } from "antd";
import React, { useEffect, useState, useMemo } from "react";
import RestStatus from "http-status-codes";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";
import { useNavigate, useMatch, useLocation } from "react-router-dom";
import routes from "../../helpers/routes";
import { actions as orderActions } from "../../contexts/order/actions";
import { useOrderDispatch, useOrderState } from "../../contexts/order";
import { actions } from "../../contexts/marketplace/actions";
import {
  useMarketplaceState,
  useMarketplaceDispatch,
} from "../../contexts/marketplace";


function useQuery() {
  const { search } = useLocation();

  return useMemo(() => new URLSearchParams(search), [search]);
}

const ProcessingOrder = () => {

  const navigate = useNavigate();
  const [sessionId, setSessionId] = useState(undefined);
  const orderDispatch = useOrderDispatch();
  const { cartList } = useMarketplaceState();
  const marketplaceDispatch = useMarketplaceDispatch();
  const [error, seterror] = useState(null)
  const { message, success } = useOrderState();
  const [api, contextHolder] = notification.useNotification();


  useEffect(() => {
    actions.fetchCartItems(marketplaceDispatch, cartList);
  }, [marketplaceDispatch, cartList]);

  const routeMatch = useMatch({
    path: routes.ProcessingOrder.url,
    strict: true,
  });

  const query = useQuery();

  useEffect(() => {
    setSessionId(query.get("session_id"));
  }, [routeMatch, query]);

  useEffect(() => {
    // getCartData();
    if (sessionId !== undefined) {
      getCartData();
    }

  }, [sessionId])


  const getCartData = async () => {
    try {
      const response = await fetch(
        `${apiUrl}/order/payment/session/${sessionId}`,
        {
          method: HTTP_METHODS.GET,
        }
      );

      const body = await response.json();
      if (response.status === RestStatus.OK) {
        if (JSON.parse(body.data.metadata.cart) !== {}) {
          if (body.data["payment_status"] === "paid") {
            const cart = JSON.parse(body.data.metadata.cart);
            let object = { paymentSessionId: sessionId, ...cart };
            handleOrderConfirm(object);
          }
        }
      } else if (response.status === RestStatus.INTERNAL_SERVER_ERROR) {
        seterror("Cannot find session ID");
        setTimeout(function () {
          navigate(routes.Checkout.url)
        }, 2000);
      } else {
        seterror(body.error);
        setTimeout(function () {
          navigate(routes.Checkout.url)
        }, 2000);
      }

    } catch (err) {
      seterror(err);
    }
  }



  const handleOrderConfirm = async (cartData) => {
    let isDone = await orderActions.createOrder(orderDispatch, cartData);
    if (isDone) {
      let orderItemAddress = [];
      cartData.orderList.forEach(c => {
        orderItemAddress.push(c.inventoryId);
      });
      let updatedCart = [];
      cartList.forEach(cart => {
        if (!orderItemAddress.includes(cart.product.address)) {
          updatedCart.push(cart);
        }
      });
      actions.addItemToCart(marketplaceDispatch, updatedCart);
      navigate(routes.Orders.url, { state: { defaultKey: "Bought" } });
    } else {
      setTimeout(function () {
        navigate(routes.Checkout.url)
      }, 2000);
    }
  };

  const openToastMarketplace = (placement) => {
    if (error != null) {
      api.error({
        message: error,
        onClose: seterror(null),
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



  return <div>
    {contextHolder}
    <div className="h-96 flex flex-col justify-center items-center">
      <Spin spinning={true} size="large" />
      <p className="mt-4">Please wait while your order is placed successfully</p>
    </div>
    {error && openToastMarketplace("bottom")}
    {message && openToastOrder("bottom")}
  </div>
};

export default ProcessingOrder;
