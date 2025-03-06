import {
  Button,
  Typography,
  InputNumber,
  Radio,
  Checkbox,
  Spin,
  Modal,
} from 'antd';
import { useState, useEffect } from 'react';
import { Images } from '../../images';
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from '../../contexts/marketplace';
import { useAuthenticateState } from '../../contexts/authentication';
import TagManager from 'react-gtm-module';
import { actions } from '../../contexts/marketplace/actions';
import { actions as orderActions } from '../../contexts/order/actions';
import { useOrderDispatch, useOrderState } from '../../contexts/order';
import { generateHtmlContent } from '../../helpers/emailTemplate';
import { PAYMENT_LABEL } from '../../helpers/constants';
import BigNumber from 'bignumber.js';
import { setCookie } from '../../helpers/cookie';

const ResponsiveCart = ({
  paymentServices,
  data,
  confirm,
  AddQty,
  MinusQty,
  ValueQty,
  removeCartList,
  openToastOrder,
  reserve,
}) => {
  // temporary fix to put USDST as top payment option, will be updated in next release
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
  const marketplaceDispatch = useMarketplaceDispatch();
  const { assetsWithEighteenDecimalPlaces } = useMarketplaceState();
  const [tax, setTax] = useState(new BigNumber(0));
  const [subTotal, setSubTotal] = useState(new BigNumber(0));
  const [total, setTotal] = useState(new BigNumber(0));
  const [modal, contextHolderForModal] = Modal.useModal();
  const orderDispatch = useOrderDispatch();
  let { hasChecked, isAuthenticated, loginUrl, user } = useAuthenticateState();
  const userOrganization = user?.organization;
  const [cartData, setCartData] = useState(data);
  const [isLoading, setIsLoading] = useState(false);
  const [faqOpenState, setFaqOpenState] = useState(
    Array(cartData.length).fill(false)
  );
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
    setCartData(data);
  }, [data]);

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

  const toggleFaq = (index) => {
    setFaqOpenState((prev) => {
      const newState = [...prev];
      newState[index] = !newState[index];
      return newState;
    });
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
      concatenatedOrderString += `$${itemTotal} <br>`;
      concatenatedOrderString += `Qty: ${itemQty} &nbsp; $${itemPrice} each (${itemPrice} ' USDST'})<br><br>`;
      orderTotal += parseFloat(itemTotal);
      if (i === cartData.length - 1) {
        concatenatedOrderString += `<hr style="border-top: 1px dotted #0A1B71; min-width: 80%; max-width: 80%; margin-left: 15px;">`;
        concatenatedOrderString += `Shipping Fee: <i><strong>Free</strong></i><br><br>`;
        concatenatedOrderString += `Order Total: $${orderTotal.toFixed(
          2
        )} <br>`;
      }
    }

    htmlContents.push(
      generateHtmlContent(customerFirstName, concatenatedOrderString)
    );
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
          .toFixed(18),
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

  const onKeyDownPress = (e, topSellingProduct) => {
    if (topSellingProduct.decimals === null) {
      // Prevent decimals
      if (e.key === "." || e.key === ",") {
        e.preventDefault();
      }
      // Prevent non-numeric keys except Backspace, Delete, and navigation keys
      if (!/^[0-9]$/.test(e.key) && 
          e.key !== "Backspace" && 
          e.key !== "Delete" && 
          e.key !== "ArrowLeft" && 
          e.key !== "ArrowRight") {
        e.preventDefault();
      }
    } else {
      // Allow decimals for products with defined decimal places
      if (
        !/[0-9.]/.test(e.key) &&
        e.key !== "Backspace" &&
        e.key !== "Delete" &&
        e.key !== "ArrowLeft" &&
        e.key !== "ArrowRight"
      ) {
        e.preventDefault();
      }
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
    <div className=" rounded-md mt-3 flex flex-col gap-[18px] sm:w-[400px] md:w-[450px] items-center">
      {contextHolderForModal}
      {cartData.map((element, index) => {
        let qty = element.qty;
        let product = element;
        return (
          <div className=" w-full" key={index}>
            <div className="w-full bg-[#d8cbcb] h-[1px]"></div>
            <div className="p-3 rounded-md w-full">
              <div className="flex justify-between">
                <div className="flex gap-x-3">
                  <img
                    src={element?.item?.image}
                    className="w-12 h-12 rounded-[4px]"
                  />
                  <Typography className="text-[#13188A] text-base mt-[-4px] font-semibold">
                    {element?.item?.name}
                  </Typography>
                </div>
                <div className="mt-[-9px]">
                  <Button
                    type="link"
                    icon={
                      <img
                        src={Images.CancelIcon}
                        alt="remove"
                        className="w-[18px] h-[18px]"
                      />
                    }
                    onClick={() => {
                      removeCartList(element.action);
                    }}
                    className="hover:text-error cursor-pointer text-xl"
                  />
                </div>
              </div>

              <div className="flex justify-between ml-[20%] items-baseline">
                <Typography className="font-semibold text-[#202020] text-sm">{`$${(element?.unitPrice).toFixed(
                  2
                )}`}</Typography>
                <div>
                  <div className="flex items-center justify-center mt-2">
                    <div
                      onClick={() => {
                        MinusQty(qty, product);
                      }}
                      className={`w-6 h-6 bg-[#E9E9E9] flex justify-center items-center rounded-full ${
                        qty === 1
                          ? 'cursor-not-allowed opacity-50'
                          : 'cursor-pointer'
                      }`}
                    >
                      <p className="text-lg text-[#202020] font-medium">-</p>
                    </div>
                    <InputNumber
                      className="w-[100px] bg-[transparent] border-none text-[#202020]  font-semibold text-sm text-center flex flex-col justify-center"
                      min={1 / Math.pow(10, product.decimals || 0)}
                      value={qty}
                      controls={false}
                      onChange={(e) => {
                        ValueQty(product, e);
                      }}
                      precision={product.decimals === 0 ? 0 : 5}
                      onKeyDown={(e) => {
                        onKeyDownPress(e, product);
                      }}
                    />
                    <div
                      onClick={() => {
                        AddQty(product);
                      }}
                      className={`w-6 h-6 bg-[#E9E9E9] flex justify-center items-center rounded-full ${
                        qty >= product.quantity
                          ? 'cursor-not-allowed opacity-50'
                          : 'cursor-pointer'
                      }`}
                    >
                      <p className="text-lg text-[#202020] font-medium">+</p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="px-3 h-10 flex justify-between items-center rounded-md mt-[14px] bg-[#F6F6F6]">
                <Typography className="text-[#202020] text-sm font-semibold">
                  Details
                </Typography>
                <Button
                  type="link"
                  icon={
                    <img
                      src={Images.Dropdown}
                      alt=""
                      className={`w-5 h-5 transition-transform transform ${
                        faqOpenState[index] ? 'rotate-180' : 'rotate-0'
                      }`}
                      onClick={() => {
                        toggleFaq(index);
                      }}
                    />
                  }
                ></Button>
              </div>

              {faqOpenState[index] && (
                <div
                  className={`overflow-hidden ${
                    faqOpenState[index]
                      ? 'max-h-[145px] open'
                      : 'max-h-0 faq-container'
                  }`}
                >
                  <div className="bg-[#F6F6F6] rounded-b-md flex flex-col gap-3 px-3 py-2">
                    <div className="w-full bg-[#BABABA] h-[1px]"></div>
                    <div className="flex justify-between">
                      <Typography className="text-sm text-[#202020] font-medium">
                        Seller:
                      </Typography>
                      <Typography className="text-sm text-[#202020] font-semibold w-[130px] sm:w-[200px] text-right overflow-hidden whitespace-nowrap text-ellipsis">
                        {element?.sellersCommonName}
                      </Typography>
                    </div>
                    <div className="flex justify-between">
                      <Typography className="text-sm text-[#202020] font-medium">
                        Unit Price($):
                      </Typography>
                      <Typography className="text-sm text-[#202020] font-semibold">{`$${(element?.unitPrice).toFixed(
                        2
                      )}`}</Typography>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
      <div className="w-full bg-[#d8cbcb] h-[1px]"></div>
      <div className="w-full px-2">
        <div className="checkout-card">
          <h3 className="text-lg p-2 font-semibold mb-4 h-12 bg-[#EEEFFA]">
            Payment Method
          </h3>
          <div className="p-2">
            <div className="rounded-lg shadow-md w-full mb-8 p-2">
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
                              <span className="ml-2 text-sm font-normal">
                                {PAYMENT_LABEL[provider?.serviceName]
                                  ? PAYMENT_LABEL[provider?.serviceName]
                                  : `Pay with ${provider?.serviceName}`}{' '}
                              </span>
                            </p>
                          </Radio>
                        )
                    )}
                </div>
              </Radio.Group>
            </div>
            {reserve && (
              <div className="p-2">
                <Checkbox defaultChecked onChange={changeChecked}>
                  Stake and earn rewards!
                </Checkbox>
              </div>
            )}
            <div className="flex justify-between items-center mb-3 p-2">
              <span className="text-base font-normal">Order Total :</span>
              <span className="text-base font-normal">{totalAmount} </span>
            </div>
            <Button
              type="primary"
              loading={isLoading}
              disabled={
                !activePaymentProviders || activePaymentProviders?.length === 0
              }
              className="w-full mt-3 mb-6 bg-blue-800 text-white h-10 text-lg"
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
        </div>
      </div>
    </div>
  );
};

export default ResponsiveCart;
