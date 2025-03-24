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
import { useEthState, useEthDispatch } from '../../contexts/eth';
import {
  useInventoryState,
  useInventoryDispatch,
} from '../../contexts/inventory';
import { useOrderState, useOrderDispatch } from '../../contexts/order';
import { actions } from '../../contexts/marketplace/actions';
import { actions as inventoryActions } from '../../contexts/inventory/actions';
import { actions as ethActions } from '../../contexts/eth/actions';
import { Images } from '../../images';
import { useState, useEffect } from 'react';
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
import BigNumber from 'bignumber.js';

const { Title, Text } = Typography;

const Checkout = () => {
  const marketplaceDispatch = useMarketplaceDispatch();
  const orderDispatch = useOrderDispatch();
  const inventoryDispatch = useInventoryDispatch();
  const ethDispatch = useEthDispatch();
  const { paymentServices, arePaymentServicesLoading } =
    usePaymentServiceState();
  const { reserves, isReservesLoading } = useInventoryState();
  const paymentServiceDispatch = usePaymentServiceDispatch();
  const [api, contextHolder] = notification.useNotification();
  const { cartList, assetsWithEighteenDecimalPlaces } = useMarketplaceState();
  const { ethstAddress, wbtcstAddress } = useEthState();
  const { isCreateOrderSubmitting, message, success } = useOrderState();

  const [mapData, setmapData] = useState([]);
  const [inputErrors, setInputErrors] = useState({});

  const calculateDecimals = (item) => {
    const decimals = assetsWithEighteenDecimalPlaces.includes(
      item.product.originAddress
    )
      ? 18
      : item.product.decimals || 0;

    return decimals;
  };
 
  const calculateTax = (item) => {
    const decimals = assetsWithEighteenDecimalPlaces.includes(
      item.product.originAddress
    )
      ? 18
      : item.product.decimals || 0;
    let price = new BigNumber(item.product.price).multipliedBy(
      new BigNumber(10).pow(decimals)
    );
    let tax = new BigNumber(CHARGES.TAX);
    let result = price.multipliedBy(tax).dividedBy(100);

    return result;
  };

  const calculateAmount = (item) => {
    const decimals = assetsWithEighteenDecimalPlaces.includes(
      item.product.originAddress
    )
      ? 18
      : item.product.decimals || 0;
    let price = new BigNumber(item.product.price).multipliedBy(
      new BigNumber(10).pow(decimals)
    );
    let tax = calculateTax(item);
    let result = price.multipliedBy(new BigNumber(item.qty)).plus(tax);

    return result;
  };

  useEffect(() => {
    actions.fetchCartItems(marketplaceDispatch, cartList);
  }, [marketplaceDispatch, cartList]);

  useEffect(() => {
    paymentServiceActions.getPaymentServices(paymentServiceDispatch, true);
    inventoryActions.getAllReserve(inventoryDispatch);
    ethActions.fetchETHSTAddress(ethDispatch);
    ethActions.fetchWBTCSTAddress(ethDispatch);
  }, [paymentServiceDispatch, inventoryDispatch]);

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
        const decimals = assetsWithEighteenDecimalPlaces.includes(
          item.product.originAddress
        )
          ? 18
          : item.product.decimals || 0;
        const isWbtcst = item.product.originAddress === wbtcstAddress;
        const isEthst = item.product.originAddress === ethstAddress;
        const saleQuantity = new BigNumber(item.product.saleQuantity).dividedBy(
          new BigNumber(10).pow(decimals)
        );
        const step = isWbtcst ? 0.0001 : isEthst ? 0.01 : decimals ? 0.01 : 1;
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
          unitPrice: new BigNumber(item.product.price).multipliedBy(
            new BigNumber(10).pow(decimals)
          ),
          saleQuantity,
          decimals,
          saleAddress: item.product.saleAddress,
          tax: calculateTax(item),
          amount: amount,
          action: item.product.address,
          qty: item.qty,
          assetRootAddress: item.product.originAddress,
          step,
          disabled: inputErrors[item.product.address] ? true : false
        });
      });

      // Return the new object
      return {
        key: key,
        value: { paymentServices: [...paymentServices], items: modifiedValue },
      };
    });
    setmapData(mapDataArray);
  }, [marketplaceDispatch, cartList, wbtcstAddress, ethstAddress]);

  const MinusQty = (qty, product) => {
    if (new BigNumber(qty).isGreaterThan(new BigNumber(product.step))) {
      let items = [...cartList];
      cartList.forEach((element, index) => {
        if (element.product.address === product.key) {
          const step = new BigNumber(product.step);
          const availableQty = new BigNumber(product.saleQuantity);

          // Get the number of decimal places in the step
          const stepStr = step.toString();
          const decimalPlaces = stepStr.includes('.')
            ? stepStr.split('.')[1].length
            : 0;

          // Calculate new qty and round to specific decimal places
          const newQty = new BigNumber(qty).minus(step);
          // Round to the nearest step
          const factor = new BigNumber(10).pow(decimalPlaces);
          const roundedQty = newQty
            .multipliedBy(factor)
            .integerValue(BigNumber.ROUND_FLOOR)
            .dividedBy(factor);

          // Handle the case where the rounded quantity exceeds available quantity
          let finalQty;
          if (roundedQty.isGreaterThan(availableQty)) {
            finalQty = availableQty.toNumber();
          } else if (roundedQty.isLessThan(step)) {
            finalQty = step.toNumber();
          } else {
            finalQty = roundedQty.toNumber();
          }

          items[index].qty = finalQty;
          actions.addItemToCart(marketplaceDispatch, items);
        }
      });
      // All checks passed, clear any previous error
      setInputErrors((prev) => ({ ...prev, [product.key]: '' }));
    }
  };

  const AddQty = (qty, product) => {
    if (
      new BigNumber(qty)
        .plus(new BigNumber(product.step))
        .lte(product.saleQuantity)
    ) {
      let items = [...cartList];
      cartList.forEach((element, index) => {
        if (element.product.address === product.key) {
          // Calculate new qty and round to match step precision
          const step = new BigNumber(product.step);
          const newQty = new BigNumber(qty).plus(step);
          // Round to the nearest step value
          const roundedQty = newQty
            .dividedBy(step)
            .integerValue(BigNumber.ROUND_FLOOR)
            .multipliedBy(step);

          items[index].qty = roundedQty.toNumber();
          actions.addItemToCart(marketplaceDispatch, items);
        }
      });
      // All checks passed, clear any previous error
      setInputErrors((prev) => ({ ...prev, [product.key]: '' }));
    }
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

  const ValueQty = (product, input) => {
    // Convert input to string for precision checking
    const decimalsAllowed = product.decimals;
    const availableQuantity = product.saleQuantity ? product.saleQuantity : 1;
    const minValBN = new BigNumber(1).dividedBy(
      new BigNumber(10).pow(decimalsAllowed)
    );
    const minVal = minValBN.toFixed(decimalsAllowed);

    // Clear any previous errors first
    let hasError = false;

    // Check 1: Exceeding allowed decimal precision
    if (input.includes('.')) {
      const decimalPart = input.split('.')[1];
      if (decimalPart.length > decimalsAllowed) {
        setInputErrors((prev) => ({
          ...prev,
          [product.key]: `Maximum precision is ${decimalsAllowed} decimal places`,
        }));
        hasError = true;
      }
    }

    // Check 2: Minimum value check
    if (
      (!hasError &&
        (new BigNumber(input).isLessThan(minVal) ||
          new BigNumber(input).isNaN())) ||
      new BigNumber(input).isLessThanOrEqualTo(0)
    ) {
      setInputErrors((prev) => ({
        ...prev,
        [product.key]: `Minimum quantity is ${minVal}`,
      }));
      hasError = true;
    }

    // Check 3: Maximum value check
    if (
      !hasError &&
      new BigNumber(input).isGreaterThan(new BigNumber(availableQuantity))
    ) {
      setInputErrors((prev) => ({
        ...prev,
        [product.key]: `Maximum quantity is ${availableQuantity}`,
      }));
      hasError = true;
    }

    // Clear error if all validations pass
    if (!hasError) {
      setInputErrors((prev) => ({ ...prev, [product.key]: '' }));
    }

    const parsed = parseFloat(input) || 0;
    let items = [...cartList];
    cartList.forEach((element, index) => {
      if (element.product.address === product.key) {
        items[index].qty = parsed;
        actions.addItemToCart(marketplaceDispatch, items);
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

  const onKeyDownPress = (e, topSellingProduct) => {
    if (topSellingProduct?.decimals) {
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
    else {
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
      render: (_, product) => {
        let qty = product.qty;
        return (
          <div>
            <div className="flex items-center justify-center mt-2">
              <div
                onClick={() => {
                  MinusQty(qty, product);
                }}
                className={`w-6 h-6 text-[17px] text-[#202020] bg-[#E9E9E9] flex justify-center items-center rounded-full ${
                  new BigNumber(qty).lte(product.step)
                    ? 'cursor-not-allowed opacity-50'
                    : 'cursor-pointer'
                }`}
              >
                -
              </div>
              <InputNumber
                className="w-[100px] bg-[transparent] border-none text-[#202020] font-semibold text-sm text-center flex flex-col justify-center"
                value={qty}
                defaultValue={qty}
                controls={false}
                stringMode
                onChange={(e) => {
                  ValueQty(product, e);
                }}
              />
              <div
                onClick={() => {
                  AddQty(qty, product);
                }}
                className={`w-6 h-6 text-[17px] text-[#202020] bg-[#E9E9E9] flex justify-center items-center rounded-full ${
                  new BigNumber(qty).isGreaterThanOrEqualTo(
                    product.saleQuantity
                  )
                    ? 'cursor-not-allowed opacity-50'
                    : 'cursor-pointer'
                }`}
              >
                +
              </div>
            </div>
            {inputErrors[product.key] && (
              <div className="text-xs mt-2" style={{ color: 'red' }}>
                {inputErrors[product.key]}
              </div>
            )}
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

  const filterReserve = (e) => {
    for (const assetReserve of e) {
      const reserve = reserves.find(
        (reserve) => reserve.assetRootAddress === assetReserve.assetRootAddress
      );
      if (reserve) {
        return reserve;
      }
    }
    return null;
  };

  return (
    <div className="mx-4 my-2 lg:mx-8 xl:mx-14">
      {contextHolder}
      {isCreateOrderSubmitting ||
      arePaymentServicesLoading ||
      isReservesLoading ||
      !wbtcstAddress ||
      !ethstAddress ? (
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
                      reserve={filterReserve(e.value.items)}
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
                      reserve={filterReserve(e.value.items)}
                      inputErrors={inputErrors}
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
