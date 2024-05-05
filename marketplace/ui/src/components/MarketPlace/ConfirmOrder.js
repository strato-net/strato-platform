import {
  Row,
  notification,
  Spin,
  Modal
} from "antd";
import {
  useMarketplaceState,
  useMarketplaceDispatch,
} from "../../contexts/marketplace";
import { useOrderState, useOrderDispatch } from "../../contexts/order";
import { useAuthenticateState } from "../../contexts/authentication";
import { actions } from "../../contexts/marketplace/actions";
import { actions as orderActions } from "../../contexts/order/actions";
import { useState, useEffect } from "react";
import { actions as inventoryAction } from "../../contexts/inventory/actions";
import {
  useInventoryDispatch,
  useInventoryState,
} from "../../contexts/inventory";
import DataTableComponent from "../DataTableComponent";
import "./index.css";
import { PAYMENT_LIST } from "../../helpers/constants";
import TagManager from "react-gtm-module";
import { setCookie } from "../../helpers/cookie";

const ConfirmOrder = ({ paymentProviders, data, columns }) => {
  const marketplaceDispatch = useMarketplaceDispatch();
  const orderDispatch = useOrderDispatch();
  const [api, contextHolder] = notification.useNotification();
  const { user, hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
  const userOrganization = user?.organization
  const { isCreateOrderSubmitting, message, success, isCreatePaymentSubmitting } = useOrderState();
  const [tax, setTax] = useState(0);
  const [total, setTotal] = useState(0);
  const inventoryDispatch = useInventoryDispatch();
  const { success: marketplaceSuccess, message: marketplaceMessage } = useMarketplaceState();
  const [modal, contextHolderForModal] = Modal.useModal();
  const [cartData, setCartData] = useState(data);

  useEffect(() => {
    setCartData(data);
  }, [data]);

  const countDown = () => {
    modal.info({
      okButtonProps: { hidden: true },
      content: (
        <>
          <p className="font-medium">
            In order to proceed with your purchase, you will first need to log in or register an account with Mercata.
          </p>
          <br />
          <p>
            You will be redirected to the sign-in page shortly.
          </p>
          <Spin className="flex justify-center mt-2" />
        </>
      ),
    });
    setTimeout(() => {
      setCookie("returnUrl", `/checkout`, 10);
      window.location.href = loginUrl;
    }, 4000);
  };

  useEffect(() => {
    let t = 0;
    cartData.forEach((item) => {
      t += item.tax;
    });
    setTax(t);
    let sum = 0;
    cartData.forEach((item) => {
      sum += item.amount;
    });
    setTotal(sum);
  }, [marketplaceDispatch, cartData]);

  const openToastOrder = (placement, message) => {
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

  const openToastMarketplace = (placement) => {
    if (marketplaceSuccess) {
      api.success({
        message: marketplaceMessage,
        onClose: actions.resetMessage(marketplaceDispatch),
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: marketplaceMessage,
        onClose: actions.resetMessage(marketplaceDispatch),
        placement,
        key: 2,
      });
    }
  };

  const handlePaymentConfirm = async (paymentProvider) => {
    actions.addItemToConfirmOrder(marketplaceDispatch, cartData);
    let orderList = [];
    cartData.forEach((item) => {
      orderList.push({
        quantity: item.qty,
        assetAddress: item.key,
        firstSale: item.firstSale,
        unitPrice: item.unitPrice
      });
    });

    let body = {
      paymentProvider: { address: paymentProvider.address },
      buyerOrganization: userOrganization,
      orderList,
      orderTotal: total + tax,
      tax: tax,
      user: user.commonName,
      email: user.email,
    };

    window.LOQ.push(['ready', async LO => {
      // Track an event
      await LO.$internal.ready('events')
      LO.events.track('Buy Now Button')
    }])
    TagManager.dataLayer({
      dataLayer: {
        event: 'pay_now_button',
      },
    });
    let data = await orderActions.createPayment(orderDispatch, body);
    if (data != null && data.url !== undefined) {
      window.location.replace(data.url);
    }
  };

  return (
    <>
      <div>
        <div className="md:mx-10 mx-5 lg:mx-14">

        </div>
      </div>
      <div className="">
        {contextHolder}
        {contextHolderForModal}
        {isCreateOrderSubmitting || isCreatePaymentSubmitting ? (
          <div className="h-screen flex justify-center items-center">
            <Spin spinning={isCreateOrderSubmitting || isCreatePaymentSubmitting} size="large" />
          </div>
        ) : (
          <div className="pb-[30px] confirm-order-body">
            <div className="pt-4 hidden lg:block border-top cart">
              <DataTableComponent
                isLoading={false}
                scrollX="100%"
                columns={columns}
                data={cartData}
                pagination={false}
              />
            </div>
            <div className="flex justify-between bg-[#EEEFFA]">
              <div className="rounded-b-md py-[15px] px-4 ml-4 hidden lg:flex lg:justify-end ">
                <div className="w-[235px] flex flex-col gap-[10px]">
                  <Row className="justify-between ">
                    <p className="text-base text-[#6A6A6A]">Sub Total:</p>
                    <p className="text-xl text-[#202020]   text-right">${total}</p>
                  </Row>
                  <Row className="justify-between ">
                    <p className="text-base text-[#6A6A6A]">Tax:</p>
                    <p className="text-xl text-[#202020]   text-right">${tax}</p>
                  </Row>
                  <Row className="justify-between">
                    <p className="text-base text-[#6A6A6A]">Total:</p>
                    <p className="text-xl text-[#202020]   text-right">
                      ${total + tax}
                    </p>
                  </Row>
                </div>
              </div>
              {paymentProviders.map((paymentProvider) => (<div className="flex md:pb-2 items-center mr-4">
                <button id="pay-now-button" className={`p-1 md:p-3 h-max rounded-lg border border-primary bg-primary hover:bg-primaryHover text-white`}
                  onClick={async () => {
                    if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                      countDown();
                    } else {
                        const saleAddresses = [];
                        const quantities = [];
                        cartData.forEach((item) => {
                          saleAddresses.push(item.saleAddress)
                          quantities.push(item.qty)
                        })
                        const checkQuantity = await orderActions.fetchSaleQuantity(orderDispatch, saleAddresses, quantities)
                        if (checkQuantity === true) {
                          handlePaymentConfirm(paymentProvider);
                        } else {
                          let insufficientQuantityMessage = "";
                          let outOfStockMessage = "";

                          checkQuantity.forEach(detail => {
                            if (detail.availableQuantity === 0) {
                              outOfStockMessage += `Product ${detail.assetName}\n`;
                            } else {
                              insufficientQuantityMessage += `Product ${detail.assetName}: ${detail.availableQuantity}\n`;
                            }
                          });

                          let errorMessage = "";
                          if (insufficientQuantityMessage) {
                            errorMessage += `The following item(s) in your cart have limited quantity available and will need to be adjusted. Please reduce the quantity to proceed:\n${insufficientQuantityMessage}`;
                          }
                          if (outOfStockMessage) {
                            if (errorMessage) errorMessage += "\n"; // Add a new line if there's already an error message
                            errorMessage += `The following item(s) are temporarily out of stock and should be removed:\n${outOfStockMessage}`;
                          }
                          openToastOrder("bottom", errorMessage);
                        }
                      }
                    }
                  }
                >
                  <div className="flex items-center mr-1">
                    {paymentProvider.checkoutText}&nbsp; 
                    {paymentProvider.imageURL && paymentProvider.imageURL !== '' ? <img src={paymentProvider.imageURL} alt={paymentProvider.serviceName} height="16px" width="16px"/> : ''}
                  </div>
                </button>
              </div>))}
            </div>
          </div>
        )}
        {marketplaceMessage && openToastMarketplace("Bottom")}
        {message && openToastOrder("bottom", message)}
      </div>
    </>
  );
};


export default ConfirmOrder;