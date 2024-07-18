import { useState, useEffect } from "react";
import { Row, Spin, Modal, Select, Button } from "antd";
import TagManager from "react-gtm-module";
// Actions
import { actions as marketplaceActions } from "../../contexts/marketplace/actions";
import { actions as orderActions } from "../../contexts/order/actions";
// Dispatch and States
import { useMarketplaceState, useMarketplaceDispatch } from "../../contexts/marketplace";
import { useOrderState, useOrderDispatch } from "../../contexts/order";
import { useAuthenticateState } from "../../contexts/authentication";
// Components
import { showToast } from "../Notification/ToastComponent";
import DataTableComponent from "../DataTableComponent";
// Other
import { setCookie } from "../../helpers/cookie";
import "./index.css";

const { Option } = Select;

const ConfirmOrder = ({ paymentProviders = [], data, columns }) => {
  // Dispatch
  const marketplaceDispatch = useMarketplaceDispatch();
  const orderDispatch = useOrderDispatch();
  // States
  const { isCreateOrderSubmitting, message, success, isCreatePaymentSubmitting } = useOrderState();
  const { success: marketplaceSuccess, message: marketplaceMessage } = useMarketplaceState();
  const { user, hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
  // useStates
  const userOrganization = user?.organization;
  const [tax, setTax] = useState(0);
  const [total, setTotal] = useState(0);
  const [modal, contextHolderForModal] = Modal.useModal();
  const [cartData, setCartData] = useState(data);
  const [selectedProvider, setSelectedProvider] = useState('');

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


  const handlePaymentConfirm = async (paymentProvider) => {
    marketplaceActions.addItemToConfirmOrder(marketplaceDispatch, cartData);
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
    let orderHashAndAssets = await orderActions.createPayment(orderDispatch, body);
    if(!orderHashAndAssets){
      setSelectedProvider('')
    }
    if (orderHashAndAssets && orderHashAndAssets !== false) {
      const [orderHash, assets] = orderHashAndAssets;
      let serviceURL = paymentProvider.serviceURL || paymentProvider.data.serviceURL;
      let checkoutRoute = paymentProvider.checkoutRoute || paymentProvider.data.checkoutRoute;
      if (serviceURL
            && serviceURL !== ''
            && checkoutRoute
            && checkoutRoute !== ''
         ) {
        const url = `${serviceURL}${checkoutRoute}?orderHash=${orderHash}&redirectUrl=${window.location.protocol}//${window.location.host}/order/status`;
        window.location.replace(url);
      } else {
        window.location.replace(`/order/status?assets=${assets}`);
      }
    }
  };

  const handleChange = async (value) => {
    const provider = paymentProviders.find(provider => provider?.serviceName === value);
    setSelectedProvider(provider);

    if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
      countDown();
    } else {
      const saleAddresses = [];
      const quantities = [];
      cartData.forEach((item) => {
        saleAddresses.push(item.saleAddress);
        quantities.push(item.qty);
      });
      const checkQuantity = await orderActions.fetchSaleQuantity(orderDispatch, saleAddresses, quantities);
      if (checkQuantity === true) {
        handlePaymentConfirm(provider);
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
        showToast({
          message: errorMessage,
          onClose: orderActions.resetMessage(orderDispatch),
          success: success,
          placement: 'bottom',
        })
      }
    }
  };

  return (
    <>
      <div>
        <div className="md:mx-10 mx-5 lg:mx-14">

        </div>
      </div>
      <div className="">
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
                <div className="w-max flex flex-col gap-[10px]">
                  <Row className="justify-between items-center ">
                    <p className="text-base text-[#6A6A6A]">Sub Total:</p>
                    <p className="text-xl text-[#202020] md:ml-5 text-right">${total} <span className="ml-1">({total * 100} STRATS)</span></p>
                  </Row>
                  <Row className="justify-start items-center ">
                    <p className="text-base text-[#6A6A6A]">Tax:</p>
                    <p className="text-xl text-[#202020] md:ml-16 text-left">${tax}</p>
                  </Row>
                  <Row className="justify-between items-center">
                    <p className="text-base text-[#6A6A6A]">Total:</p>
                    <p id="totalPrice" className="text-xl text-[#202020] md:ml-5 text-right">
                      ${total + tax} <span className="ml-1">({(total + tax) * 100} STRATS)</span>
                    </p>
                  </Row>
                </div>
              </div>
              <div id="review-and-submit" className="flex md:pb-2 items-center mr-4">
                <div className="mr-4">
                  <Select
                    defaultValue={selectedProvider?.serviceName}
                    className="w-[250px] text-center selected-payment-option"
                    onChange={handleChange}
                    placeholder="Select Payment Option"
                  >
                    {paymentProviders && paymentProviders.map(provider => (
                      provider && <Option className='payment-dropdown' key={provider?.serviceName} value={provider?.serviceName}>
                        {provider?.checkoutText}
                        <img src={provider?.imageURL} alt={provider?.serviceName} style={{ width: 20, height: 20, marginRight: 8 }} />
                      </Option>
                    ))}
                  </Select>
                </div>
              </div>
            </div>
          </div>
        )}
        {marketplaceMessage && showToast({
         message: marketplaceMessage,
         onClose: marketplaceActions.resetMessage(marketplaceDispatch),
          success: marketplaceSuccess,
          placement: 'bottom',
        })}
        {message && showToast({
          message: message,
          onClose: orderActions.resetMessage(orderDispatch),
          success: success,
          placement: 'bottom',
        })}
      </div>
    </>
  );
};

export default ConfirmOrder;
