import React from 'react';
import {
  Breadcrumb,
  Typography,
  notification,
  Spin,
  Image,
  InputNumber,
  Button,
} from 'antd';
import {
  useMarketplaceState,
  useMarketplaceDispatch,
} from '../../contexts/marketplace';
import { useOrderState, useOrderDispatch } from '../../contexts/order';
import { actions } from '../../contexts/marketplace/actions';
import { Images } from '../../images';
import { useState, useEffect, useMemo } from 'react';
import './index.css';
import { CHARGES } from '../../helpers/constants';
import ClickableCell from '../ClickableCell';
import routes from '../../helpers/routes';
import ConfirmOrder from './ConfirmOrder';
import TagManager from 'react-gtm-module';
import image_placeholder from '../../images/resources/image_placeholder.png';
import ResponsiveCart from './ResponsiveCart';
import {
  usePaymentServiceDispatch,
  usePaymentServiceState,
} from '../../contexts/payment';
import { actions as paymentServiceActions } from '../../contexts/payment/actions';
import Decimal from 'decimal.js';

const { Title, Text } = Typography;

const Checkout = () => {
  const marketplaceDispatch = useMarketplaceDispatch();
  const orderDispatch = useOrderDispatch();
  const { paymentServices, arePaymentServicesLoading } =
    usePaymentServiceState();
  const paymentServiceDispatch = usePaymentServiceDispatch();
  const [api, contextHolder] = notification.useNotification();
  const { cartList, USDSTAddress, assetsWithEighteenDecimalPlaces } = useMarketplaceState();
  const { isCreateOrderSubmitting, message, success } = useOrderState();

  const [mapData, setmapData] = useState([]);

  const calculateTax = (item) => {
    const is18DecimalPlaces = assetsWithEighteenDecimalPlaces.includes(item.product.originAddress);
    let price = new Decimal( is18DecimalPlaces ? item.product.price * Math.pow(10, 18) : item.product.price);
    let tax = new Decimal(CHARGES.TAX);
    let result = price.mul(tax).div(100);

    return parseFloat(result);
  };

  const calculateAmount = (item) => {
    const is18DecimalPlaces = assetsWithEighteenDecimalPlaces.includes(item.product.originAddress);
    let price = new Decimal(is18DecimalPlaces ? item.product.price * Math.pow(10, 18) : item.product.price);
    let tax = calculateTax(item);
    let result = price.mul(item.qty).plus(tax);

    return parseFloat(result);
  };

  useEffect(() => {
    actions.fetchCartItems(marketplaceDispatch, cartList);
  }, [marketplaceDispatch, cartList]);

  useEffect(() => {
    paymentServiceActions.getPaymentServices(paymentServiceDispatch, true);
  }, [paymentServiceDispatch]);

  useEffect(() => {
    const map = new Map();
    for (const obj of cartList) {
      const org = obj.product.ownerCommonName;
      const newPPs = new Set(obj.product.paymentServices);
      if (!map.has(org)) {
        map.set(org, { paymentServices: newPPs, items: [] });
      }
      const oldPPs = map.get(org).paymentServices;
      map.get(org).items.push(obj);
      map.get(org).paymentServices = new Set(
        [...oldPPs].filter((x) => newPPs.has(x))
      );
    }
    const mapDataArray = Array.from(map, (entry, index) => {
      // Modify the values and keys as needed
      const [key, value] = entry;
      const { paymentServices, items } = value;
      let modifiedValue = [];
      items.forEach((item) => {
        const is18DecimalPlaces = assetsWithEighteenDecimalPlaces.includes(item.product.originAddress);
        const parts = item.product.contract_name.split('-');
        let amount = calculateAmount(item);

        modifiedValue.push({
          key: item.product.address,
          item: {
            name: item.product.name,
            image:
              item.product['BlockApps-Mercata-Asset-images'] &&
              item.product['BlockApps-Mercata-Asset-images'].length > 0
                ? item.product['BlockApps-Mercata-Asset-images'][0].value
                : image_placeholder,
            status: 'Active',
          },
          category: parts[parts.length - 1],
          firstSale:
            item.product.address === item.product.originAddress ? true : false,
          sellersCommonName: item.product.ownerCommonName,
          unitOfMeasure: item.product.unitOfMeasurement,
          unitPrice: is18DecimalPlaces ? item.product.price * Math.pow(10, 18) : item.product.price,
          quantity: is18DecimalPlaces ? item.product.saleQuantity / Math.pow(10, 18) : item.product.saleQuantity,
          saleAddress: item.product.saleAddress,
          tax: calculateTax(item),
          amount: amount,
          action: item.product.address,
          qty: item.qty,
        });
      });

      // Return the new object
      return {
        key: key,
        value: { paymentServices: [...paymentServices], items: modifiedValue },
      };
    });
    setmapData(mapDataArray);
  }, [marketplaceDispatch, cartList]);

  const MinusQty = (qty, product) => {
    if (qty <= 1) {
      return;
    }

    let items = [...cartList];
    cartList.forEach((element, index) => {
      if (element.product.address === product.key) {
        items[index].qty -= 1;
        actions.addItemToCart(marketplaceDispatch, items);
      }
    });
  };

  const AddQty = (product) => {
    let items = [...cartList];
    cartList.forEach((element, index) => {
      if (element.product.address === product.key) {
        const availableQuantity = product.quantity ? product.quantity : 1;
        if (items[index].qty + 1 <= availableQuantity) {
          items[index].qty += 1;
          actions.addItemToCart(marketplaceDispatch, items);
        }
      }
    });
  };

  const removeCartList = (text) => {
    let items = [...cartList];
    items.splice(
      items.findIndex(function (i) {
        window.LOQ = window.LOQ || [];
        window.LOQ.push([
          'ready',
          async (LO) => {
            // Track an event
            await LO.$internal.ready('events');
            LO.events.track('Delete Cart Item', {
              product: i.product.name,
              category: i.product.category,
            });
          },
        ]);
        TagManager.dataLayer({
          dataLayer: {
            event: 'delete_item_from_cart',
            product_name: i.product.name,
            category: i.product.category,
          },
        });
        return i.product.address === text;
      }),
      1
    );
    actions.deleteCartItem(marketplaceDispatch, items);
  };

  const ValueQty = (product, e) => {
    e = parseInt(e || 0);
    let items = [...cartList];
    cartList.forEach((element, index) => {
      if (element.product.address === product.key) {
        const availableQuantity = product.quantity ? product.quantity : 1;
        if (!e || e === '' || e === 0) {
          items[index].qty = 1;
          actions.addItemToCart(marketplaceDispatch, items);
        } else if (e <= availableQuantity) {
          items[index].qty = e;
          actions.addItemToCart(marketplaceDispatch, items);
        } else {
          items[index].qty = availableQuantity;
          actions.addItemToCart(marketplaceDispatch, items);
        }
      }
    });
  };

  const openToastOrder = (placement, message) => {
    if (success) {
      api.success({
        message: message,
        onClose: actions.resetMessage(orderDispatch),
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: message,
        onClose: actions.resetMessage(orderDispatch),
        placement,
        key: 2,
      });
    }
  };

  const columns = [
    {
      title: (
        <Text className="text-[#202020] text-base font-semibold px-6">
          Items
        </Text>
      ),
      dataIndex: 'item',
      width: '230px',
      render: (text) => {
        return (
          <div className="flex gap-3 items-center ml-3">
            <img
              className=" w-10 h-10 md:w-[52px] md:h-[52px] lg:w-14 lg:h-14  object-contain rounded-[4px]"
              alt=""
              src={text.image}
            />
            <p className="text-primary text-sm font-semibold">
              {decodeURIComponent(text.name)}
            </p>
          </div>
        );
      },
    },
    {
      title: (
        <Text className="text-[#202020] text-base font-semibold">Seller</Text>
      ),
      dataIndex: 'sellersCommonName',
      align: 'center',
      render: (text) => (
        <p className="text-center font-semibold text-sm">{text}</p>
      ),
    },
    {
      title: (
        <Text className="text-[#202020] text-base font-semibold">
          Unit Price($)
        </Text>
      ),
      dataIndex: 'unitPrice',
      align: 'center',
      render: (text) => (
        <p className=" text-sm text-[#202020] font-semibold font-sans">
          {'$' + text.toFixed(2)}
        </p>
      ),
    },
    {
      title: (
        <Text className="text-[#202020] text-base font-semibold">Quantity</Text>
      ),
      dataIndex: 'quantity',
      align: 'center',
      render: (text, product) => {
        let qty = product.qty;
        return (
          <div className="flex items-center justify-center mt-2">
            <div
              onClick={() => {
                MinusQty(qty, product);
              }}
              className={`w-6 h-6 text-[17px] text-[#202020] bg-[#E9E9E9] flex justify-center items-center rounded-full ${qty === 1 ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            >
              -
            </div>
            <InputNumber
              className="w-[100px] bg-[transparent] border-none text-[#202020]  font-semibold text-sm text-center flex flex-col justify-center"
              min={1}
              value={qty}
              defaultValue={qty}
              controls={false}
              onChange={(e) => {
                ValueQty(product, e);
              }}
            />
            <div
              onClick={() => {
                AddQty(product);
              }}
              className={`w-6 h-6 text-[17px] text-[#202020] bg-[#E9E9E9] flex justify-center items-center rounded-full ${qty >= product.quantity ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`}
            >
              +
            </div>
          </div>
        );
      },
    },
    {
      title: <Text className="text-[#202020] text-base font-semibold "></Text>,
      dataIndex: 'action',
      align: '',
      width: '4%',
      render: (text) => {
        return (
          <Button
            type="link"
            icon={<img src={Images.RemoveIcon} alt="remove" className="" />}
            onClick={() => {
              removeCartList(text);
            }}
            className="hover:text-error cursor-pointer text-xl"
          />
        );
      },
    },
  ];

  const filterPaymentServices = (e) => {
    const filteredPaymentServices = e.map((assetPaymentServices) =>
      paymentServices.find(
        (paymentService) =>
          paymentService.creator === assetPaymentServices.value.creator &&
          paymentService.serviceName === assetPaymentServices.value.serviceName
      )
    );

    return filteredPaymentServices;
  };

  return (
    <div className="mx-4 my-2 lg:mx-8 xl:mx-14">
      {contextHolder}
      {isCreateOrderSubmitting || arePaymentServicesLoading ? (
        <div className="flex justify-center items-center min-h-screen">
          <Spin spinning={isCreateOrderSubmitting} size="large" />
        </div>
      ) : (
        <div className="pb-8">
          <Breadcrumb>
            <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
              <ClickableCell href={routes.Marketplace.url}>
                <p className="text-sm text-[#13188A] font-semibold">Home</p>
              </ClickableCell>
            </Breadcrumb.Item>
            <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
              <p className="text-sm text-[#202020] font-medium">Checkout</p>
            </Breadcrumb.Item>
          </Breadcrumb>

          {/* Title for Cart Page: My Cart */}
          {/* <div className="pt-[18px] lg:pt-6">
            <p className="text-base md:text-xl lg:text-2xl font-bold lg:font-semibold leading-9">
              My Cart
            </p>
          </div> */}
          <div className="grid grid-cols-1 sm:place-items-center gap-3 lg:block">
            {mapData.length === 0 ? (
              <div className="flex flex-col items-center">
                <Image src={Images.noProductSymbol} preview={false} />
                <Title level={3} className="mt-2">
                  No item found
                </Title>
              </div>
            ) : (
              mapData.map((e, index) => (
                <React.Fragment key={e.key}>
                  <div className={`hidden lg:block`}>
                    <ConfirmOrder
                      paymentServices={filterPaymentServices(
                        e.value.paymentServices
                      )}
                      data={e.value.items}
                      columns={columns}
                    />
                  </div>
                  <div className="lg:hidden">
                    <ResponsiveCart
                      paymentServices={filterPaymentServices(
                        e.value.paymentServices
                      )}
                      data={e.value.items}
                      AddQty={AddQty}
                      MinusQty={MinusQty}
                      ValueQty={ValueQty}
                      removeCartList={removeCartList}
                      openToastOrder={openToastOrder}
                    />
                  </div>
                </React.Fragment>
              ))
            )}
          </div>
        </div>
      )}
      {message && openToastOrder('bottom', message)}
    </div>
  );
};

export default Checkout;
