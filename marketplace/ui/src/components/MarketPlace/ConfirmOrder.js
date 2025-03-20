import {
  Row,
  notification,
  Spin,
  Modal,
  Col,
  Radio,
  Button,
  Tooltip,
  Checkbox,
} from 'antd';
import {
  useMarketplaceState,
  useMarketplaceDispatch,
} from '../../contexts/marketplace';
import BigNumber from 'bignumber.js';
import { useOrderState, useOrderDispatch } from '../../contexts/order';
import { useAuthenticateState } from '../../contexts/authentication';
import { actions } from '../../contexts/marketplace/actions';
import { actions as orderActions } from '../../contexts/order/actions';
import { useState, useEffect } from 'react';
import DataTableComponent from '../DataTableComponent';
import './index.css';
import TagManager from 'react-gtm-module';
import { setCookie } from '../../helpers/cookie';
import { generateHtmlContent } from '../../helpers/emailTemplate';
import { PAYMENT_LABEL } from '../../helpers/constants';

const ConfirmOrder = ({ paymentServices = [], reserve, data, columns }) => {
  const marketplaceDispatch = useMarketplaceDispatch();
  const orderDispatch = useOrderDispatch();
  const [api, contextHolder] = notification.useNotification();
  const { user, hasChecked, isAuthenticated, loginUrl } =
    useAuthenticateState();
  const userOrganization = user?.organization;
  const {
    isCreateOrderSubmitting,
    message,
    success,
    isCreatePaymentSubmitting,
  } = useOrderState();
  const [isLoading, setIsLoading] = useState(false);
  const [tax, setTax] = useState(new BigNumber(0));
  const [subTotal, setSubTotal] = useState(new BigNumber(0));
  const [total, setTotal] = useState(new BigNumber(0));
  const {
    success: marketplaceSuccess,
    message: marketplaceMessage,
    assetsWithEighteenDecimalPlaces,
  } = useMarketplaceState();
  const [modal, contextHolderForModal] = Modal.useModal();
  const [cartData, setCartData] = useState(data);

  const activePaymentProviders =
    paymentServices[0] !== undefined
      ? paymentServices.filter((paymentProvider) => paymentProvider?.isActive)
      : [];
  const USDSTIndex = activePaymentProviders.findIndex((service) =>
    service.serviceName.toLowerCase().includes('usdst')
  );
  if (USDSTIndex > 0) {
    const [USDSTObject] = activePaymentProviders.splice(USDSTIndex, 1);
    activePaymentProviders.unshift(USDSTObject);
  }
  const initialPaymentState =
    activePaymentProviders?.length !== 0 ? activePaymentProviders[0] : '';
  const [selectedProvider, setSelectedProvider] = useState(initialPaymentState);

  useEffect(() => {
    setCartData(data);
  }, [data]);

  const [stakeChecked, setStakeChecked] = useState(true);

  const changeChecked = (e) => {
    setStakeChecked(e.target.checked);
  };

  const countDown = () => {
    modal.info({
      okButtonProps: { hidden: true },
      content: (
        <>
          <p className="font-medium">
            In order to proceed with your purchase, you will first need to log
            in or register an account with Mercata.
          </p>
          <br />
          <p>You will be redirected to the sign-in page shortly.</p>
          <Spin className="flex justify-center mt-2" />
        </>
      ),
    });
    setTimeout(() => {
      setCookie('returnUrl', `/checkout`, 10);
      window.location.href = loginUrl;
    }, 4000);
  };

  useEffect(() => {
    let t = new BigNumber(0);
    let sum = new BigNumber(0);
    cartData.forEach((item) => {
      t = t.plus(new BigNumber(item.tax));
      sum = sum.plus(new BigNumber(item.amount));
    });

    setTax(t.toFixed(2));
    setSubTotal(sum.toString());
    setTotal(sum.plus(t).toFixed(2));
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

  // Generating Email Confirmation HTML
  let htmlContents = [];
  const generate_HTML_Content = async (username) => {
    htmlContents = [];

    let customerFirstName = username;

    // Construct Email with order details
    let concatenatedOrderString = '';
    let orderTotal = 0;
    for (let i = 0; i < cartData.length; i++) {
      let orderItem = cartData[i];
      let itemName = decodeURIComponent(orderItem.item.name);
      let itemPrice = parseFloat(orderItem.unitPrice).toFixed(2);
      let itemQty = orderItem.qty;
      let itemTotal = (itemPrice * itemQty).toFixed(2);

      concatenatedOrderString += `${itemName}:\n`;
      concatenatedOrderString = `$${itemTotal} (${itemTotal} ' USDST'})<br>`;
      concatenatedOrderString += `Qty: ${itemQty} &nbsp; $${itemPrice} each (${itemPrice} ' USDST'} each)<br><br>`;
      orderTotal += parseFloat(itemTotal);
      if (i === cartData.length - 1) {
        concatenatedOrderString += `<hr style="border-top: 1px dotted #0A1B71; min-width: 80%; max-width: 80%; margin-left: 15px;">`;
        concatenatedOrderString += `Shipping Fee: <i><strong>Free</strong></i><br><br>`;
        concatenatedOrderString += `Order Total: $${orderTotal.toFixed(
          2
        )} (${orderTotal.toFixed(2)} ' USDST')<br>`;
      }
    }

    htmlContents.push(
      generateHtmlContent(customerFirstName, concatenatedOrderString)
    );
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

  const handlePaymentConfirm = async (paymentService, reserve, asset) => {
    actions.addItemToConfirmOrder(marketplaceDispatch, cartData);
    let orderList = [];
    cartData.forEach((item) => {
      const decimals = assetsWithEighteenDecimalPlaces.includes(item.key)
        ? 18
        : item.decimals || 0;

      const quantity = new BigNumber(item.qty);
      const unitPrice = new BigNumber(item.unitPrice);

      orderList.push({
        quantity: quantity
          .multipliedBy(new BigNumber(10).pow(decimals))
          .toFixed(0),
        decimals: decimals,
        assetAddress: item.key,
        firstSale: item.firstSale,
        unitPrice: unitPrice
          .dividedBy(new BigNumber(10).pow(decimals))
          .toFixed(decimals),
      });
    });

    generate_HTML_Content(user.commonName);

    let body = {
      paymentService: {
        address: paymentService.address,
        serviceName: paymentService.serviceName,
      },
      buyerOrganization: userOrganization,
      orderList,
      orderTotal: total,
      tax: tax,
      user: user.commonName,
      htmlContents: htmlContents,
    };

    window.LOQ.push([
      'ready',
      async (LO) => {
        // Track an event
        await LO.$internal.ready('events');
        LO.events.track('Buy Now Button');
      },
    ]);
    TagManager.dataLayer({
      dataLayer: {
        event: 'pay_now_button',
      },
    });
    let checkoutHashAndAssets = await orderActions.createPayment(
      orderDispatch,
      body
    );

    if (checkoutHashAndAssets && checkoutHashAndAssets !== false) {
      const [checkoutHash, assets] = checkoutHashAndAssets;
      let serviceURL =
        paymentService.serviceURL || paymentService.data.serviceURL;
      let checkoutRoute =
        paymentService.checkoutRoute || paymentService.data.checkoutRoute;
      if (
        serviceURL &&
        serviceURL !== '' &&
        checkoutRoute &&
        checkoutRoute !== ''
      ) {
        const redirectUrlValue = `${window.location.protocol}//${
          window.location.host
        }/order/status?assets=${assets}&orderHash=${checkoutHash}${
          reserve ? `&stake=${reserve},${asset}` : ''
        }`;

        // Encode the URL so it’s safe to pass as a query parameter
        const encodedRedirectUrl = encodeURIComponent(redirectUrlValue);

        const url = `${serviceURL}${checkoutRoute}?checkoutHash=${checkoutHash}&redirectUrl=${encodedRedirectUrl}`;
        window.location.replace(url);
      } else {
        window.location.replace(
          `/order/status?assets=${assets}&orderHash=${checkoutHash}${
            reserve ? `&stake=${reserve},${asset}` : ''
          }`
        );
      }
    } else {
      setIsLoading(false);
    }
  };

  const handleChange = async (value) => {
    const provider = paymentServices.find(
      (provider) => provider?.serviceName === value
    );
    setSelectedProvider(provider);
  };

  const handlePlaceOrder = async (reserve = null, asset = null) => {
    if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
      countDown();
    } else {
      const saleAddresses = [];
      const quantities = [];
      cartData.forEach((item) => {
        saleAddresses.push(item.saleAddress);
        quantities.push(item.qty);
      });
      const checkQuantity = await orderActions.fetchSaleQuantity(
        orderDispatch,
        saleAddresses,
        quantities
      );
      if (checkQuantity === true) {
        if (selectedProvider?.serviceName === 'Stripe' && total < 0.5) {
          openToastOrder(
            'bottom',
            'The minimum order amount is $0.50. Please increase the item quantity to account for this.'
          );
        } else {
          setIsLoading(true);
          await handlePaymentConfirm(selectedProvider, reserve, asset);
        }
      } else {
        let insufficientQuantityMessage = '';
        let outOfStockMessage = '';

        checkQuantity.forEach((detail) => {
          if (detail.availableQuantity === 0) {
            outOfStockMessage += `Product ${detail.assetName}\n`;
          } else {
            insufficientQuantityMessage += `Product ${detail.assetName}: ${detail.availableQuantity}\n`;
          }
        });

        let errorMessage = '';
        if (insufficientQuantityMessage) {
          errorMessage += `The following item(s) in your cart have limited quantity available and will need to be adjusted. Please reduce the quantity to proceed:\n${insufficientQuantityMessage}`;
        }
        if (outOfStockMessage) {
          if (errorMessage) errorMessage += '\n'; // Add a new line if there's already an error message
          errorMessage += `The following item(s) are temporarily out of stock and should be removed:\n${outOfStockMessage}`;
        }
        openToastOrder('bottom', errorMessage);
      }
    }
  };

  const totalAmount =
    selectedProvider?.serviceName === 'USDST' ||
    selectedProvider?.serviceName?.includes('USDST')
      ? `${new BigNumber(subTotal).toString()} USDST`
      : selectedProvider?.serviceName === 'Stripe'
      ? `${(Math.ceil(subTotal * 100) / 100).toFixed(2)} USD`
      : `${subTotal} ${selectedProvider?.serviceName || 'USD'}`;

  return (
    <>
      <div>
        <div className="md:mx-10 mx-5 lg:mx-14"></div>
      </div>
      <div className="">
        {contextHolder}
        {contextHolderForModal}
        {isCreateOrderSubmitting || isCreatePaymentSubmitting || isLoading ? (
          <div className="h-screen flex justify-center items-center">
            <Spin
              spinning={isCreateOrderSubmitting || isCreatePaymentSubmitting}
              size="large"
            />
          </div>
        ) : (
          <div className="pb-[30px] confirm-order-body">
            <div className="mt-4 hidden lg:block border-top cart checkout-card">
              <h3 className="text-lg font-semibold h-12 p-2 pl-6 bg-[#EEEFFA]">
                Item Details
              </h3>
              <DataTableComponent
                isLoading={false}
                scrollX="100%"
                columns={columns}
                data={cartData}
                pagination={false}
              />
            </div>
            <Row className="w-full mt-10 flex justify-between">
              <Col xs={11} className="checkout-card">
                <h3 className="text-lg font-semibold mb-4 h-12 p-2 pl-6 bg-[#EEEFFA]">
                  Payment Method
                </h3>
                <div className="p-6 rounded-lg shadow-md w-full">
                  <Radio.Group
                    onChange={(e) => {
                      handleChange(e.target.value);
                    }}
                    value={selectedProvider?.serviceName}
                    className="w-full"
                  >
                    <div className="flex flex-col space-y-4">
                      {activePaymentProviders &&
                        activePaymentProviders.map(
                          (provider) =>
                            provider && (
                              <Radio
                                value={provider?.serviceName}
                                className="w-full"
                              >
                                <p className="flex text-base font-normal items-center">
                                  <span className="ml-2">
                                    {PAYMENT_LABEL[provider?.serviceName]
                                      ? PAYMENT_LABEL[provider?.serviceName]
                                      : `Pay with ${provider?.serviceName}`}
                                  </span>
                                </p>
                              </Radio>
                            )
                        )}
                    </div>
                  </Radio.Group>
                </div>
              </Col>
              <Col xs={11} className="checkout-card">
                <h3 className="text-lg font-semibold mb-4 h-12 p-2 pl-6 bg-[#EEEFFA]">
                  Payment Summary
                </h3>
                <div className="p-4 rounded-lg shadow-md w-full">
                  <div className="flex justify-between items-center mb-6">
                    <span className="text-base font-normal">Order Total :</span>
                    <span className="text-base font-normal">
                      {totalAmount}{' '}
                    </span>
                  </div>
                  {reserve && (
                    <div className="mb-6">
                      <Checkbox defaultChecked onChange={changeChecked}>
                        Stake and earn rewards!
                      </Checkbox>
                    </div>
                  )}
                  <Button
                    type="primary"
                    disabled={
                      !activePaymentProviders ||
                      activePaymentProviders?.length === 0 || 
                      cartData.some(item => item.disabled)
                    }
                    className="w-full bg-blue-800 text-white h-10 text-lg"
                    onClick={() =>
                      reserve && stakeChecked
                        ? handlePlaceOrder(
                            reserve?.address,
                            reserve?.assetRootAddress
                          )
                        : handlePlaceOrder()
                    }
                  >
                    Place Order
                  </Button>
                </div>
              </Col>
            </Row>
          </div>
        )}
        {marketplaceMessage && openToastMarketplace('Bottom')}
        {message && openToastOrder('bottom', message)}
      </div>
    </>
  );
};

export default ConfirmOrder;
