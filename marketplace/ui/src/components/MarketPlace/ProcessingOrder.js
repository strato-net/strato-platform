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
  // const { cartList } = useMarketplaceState();
  const marketplaceDispatch = useMarketplaceDispatch();
  const [error, seterror] = useState(null)
  const { message, success } = useOrderState();
  const [api, contextHolder] = notification.useNotification();


  const storedData = useMemo(() => {
    return JSON.parse(window.localStorage.getItem("cartList") ?? []);
  }, []);

  // useEffect(() => {
  //   actions.fetchCartItems(marketplaceDispatch, cartList);
  // }, [marketplaceDispatch, cartList]);

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

    // Construct Email with order details
    let concatenatedOrderString = "";
    let orderTotal = 0; 
    for (let i = 0; i < cartData.orderList.length; i++) {
      let orderItem = cartData.orderList[i];
      let itemName = orderItem.name.replace(/%20/g, ' '); 
      let itemPrice = parseFloat(orderItem.unitPrice).toFixed(2); 
      let itemQty = orderItem.quantity;
      let itemTotal = (itemPrice * itemQty).toFixed(2); 
  
      concatenatedOrderString += `${itemName}:\n`; 
      concatenatedOrderString += `$${itemTotal} <br>`; 
      concatenatedOrderString += `Qty: ${itemQty} &nbsp; $${itemPrice} each <br><br>`; 
      orderTotal += parseFloat(itemTotal); 
      if (i === cartData.orderList.length - 1) {
        concatenatedOrderString += `<hr style="border-top: 1px dotted #0A1B71; min-width: 80%; max-width: 80%; margin-left: 15px;">`;
        concatenatedOrderString += `Sales Tax: $${parseFloat(cartData.tax).toFixed(2)} <br>`;
        concatenatedOrderString += `Shipping Fee: <i><strong>Free</strong></i><br><br>`;
        concatenatedOrderString += `Order Total: $${orderTotal.toFixed(2)} <br>`;
      }
    }

    let customerFirstName = cartData.user.split(" ")[0];

    const htmlContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Your Order Confirmation</title>
        <style>
            body {
                font-family: Arial, sans-serif;
            }
            .container {
                margin: 20px auto;
                padding: 20px;
                background-color: #ffffff;
                border-radius: 10px;
                border: 1px solid #0A1B71;
                max-width: 600px;
            }
            h2 {
                color: #0A1B71;
            }
            ul {
                list-style-type: none;
                padding: 0;
            }
            p {
                margin: 10px 0;
            }
            .signature {
                display: flex;
                align-items: center;
            }
            .logo {
                margin-right: 10px;
                width: 60px;
                height: 60px;
            }
            .logo-text {
                color: #000;
                font-weight: 100;
            }
            .footer {
                font-size: 10px;
                margin-top: 20px;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <h2>Hello <strong>${customerFirstName},</strong></h2>
            
            <p>Thank you for shopping with us. Your recent order on the BlockApps Mercata Marketplace has been successfully processed. Below are the details of your purchase:</p>
            
            <ul>
                ${concatenatedOrderString}
            </ul>
            
            <p>If you have any questions or need assistance with your order, please feel free to contact our customer support team at sales@blockapps.net.</p>
            
            <div class="signature">
            <img class="logo" src="https://blockapps.net/wp-content/uploads/2022/08/blockapps-avatar.jpg" alt="Logo" />

                <h3 class="logo-text">BlockApps Marketplace <a href="https://blockapps.net/products/strato-mercata/" rel="noopener noreferrer"><em>powered by STATO Mercata™</em><a></h3>
            </div>
            <p class="footer">This email was sent from a notification-only address and cannot accept incoming email. Please do not reply to this message.</p>
        </div>
    </body>
    </html>
    `;

    // Prepare order data to be sent to order controller
    const orderList = cartData.orderList.map(c => {
      return {
        inventoryId: c.inventoryId,
        quantity: c.quantity,
      }
    });
    
    const body = {
      buyerOrganization: cartData.buyerOrganization,
      orderList: orderList,
      orderTotal: cartData.orderTotal,
      paymentSessionId: cartData.paymentSessionId,
      shippingAddress: cartData.shippingAddress,
      to: cartData.email,
      subject: "Your Order Confirmation",
      htmlContent: htmlContent,
    };

    let isDone = await orderActions.createOrder(orderDispatch, body);
    if (isDone) {
      let orderItemAddress = [];
      cartData.orderList.forEach(c => {
        orderItemAddress.push(c.inventoryId);
      });
      let updatedCart = [];
      storedData.forEach(cart => {
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
