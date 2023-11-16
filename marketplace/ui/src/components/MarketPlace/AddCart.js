import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Typography, InputNumber } from "antd";
import TagManager from "react-gtm-module";
import { MinusOutlined, PlusOutlined, DeleteOutlined } from "@ant-design/icons";
// Components
import ConfirmOrderModel from "./ConfirmOrderModel";
import CartComponent from "./CartComponent";
import BreadCrumbComponent from "../BreadCrumb/BreadCrumbComponent";
import LoaderComponent from "../Loader/LoaderComponent";
import ToastComponent from "../ToastComponent/ToastComponent";
import NoProductComponent from "../NoProductFound/NoProductComponent";
// Actions
import { actions as marketplaceActions } from "../../contexts/marketplace/actions";
import { actions as orderActions } from "../../contexts/order/actions";
// Dispatch and States
import { useMarketplaceState, useMarketplaceDispatch } from "../../contexts/marketplace";
import { useOrderState, useOrderDispatch } from "../../contexts/order";
// css, constants,
import "./index.css";
import { CHARGES, UNIT_OF_MEASUREMENTS } from "../../helpers/constants";

const { Text } = Typography;

const Checkout = ({ user }) => {
  const navigate = useNavigate();
  // dispatch
  const marketplaceDispatch = useMarketplaceDispatch();
  const orderDispatch = useOrderDispatch();
  // states
  const { isCreateOrderSubmitting, message, success } = useOrderState();
  const { cartList } = useMarketplaceState();

  const [open, setOpen] = useState(false);
  const [tax, setTax] = useState(0);
  const [shipping, setShipping] = useState(0);
  const [total, setTotal] = useState(0);
  const [mapData, setMapData] = useState([])

  const calculateTax = (item) => {
    let tax = item.product.taxDollarAmount === 0 ? Math.round(item.product.pricePerUnit * (item.product.taxPercentageAmount / 100)) : (item.product.taxDollarAmount)
    return tax * item.qty
  };

  const calculateShipping = (item) => {
    return (item.product.pricePerUnit * item.qty * CHARGES.SHIPPING);
  };

  let storedData
  useEffect(() => {
    let cartData = window.localStorage.getItem("cartList");
    if (cartData) {
      storedData = JSON.parse(cartData);
    }
  }, [window.localStorage.getItem("cartList")]);

  useEffect(() => {
    marketplaceActions.fetchCartItems(marketplaceDispatch, storedData);
  }, [marketplaceDispatch, storedData]);

  useEffect(() => {
    const map = new Map();
    for (const obj of (cartList || [])) {
      const org = obj.product.ownerOrganization;
      if (!map.has(org)) {
        map.set(org, []);
      }
      map.get(org).push(obj);
    }
    const mapDataArray = Array.from(map, (entry, index) => {
      // Modify the values and keys as needed
      const [key, value] = entry;
      let modifiedValue = [];
      value.forEach(item => {
        const imgUrl = item.product.productImageLocation?.length > 0 ? item.product.productImageLocation[0] : ''
        modifiedValue.push({
          key: item.product.address,
          item: {
            name: item.product.name,
            image: imgUrl,
            status: item.product.isActive ? "Active" : "Inactive",
          },
          sellerOrganization: item.product.ownerOrganization,
          unitOfMeasure: item.product.unitOfMeasurement,
          unitPrice: item.product.pricePerUnit,
          quantity: item.product.address,
          isTaxPercentage: item.product.isTaxPercentage,
          tax: calculateTax(item),
          shippingCharges: calculateShipping(item),
          amount:
            item.product.isTaxPercentage ? ((item.product.pricePerUnit * item.qty) + calculateTax(item)) : ((item.product.pricePerUnit + item.product.taxes) * item.qty),
          action: item.product.address,
          qty: item.qty,
        });
      });

      // Return the new object
      return { key: key, value: modifiedValue };
    });

    setMapData(mapDataArray)

    let t = 0;
    cartList?.forEach((item) => {
      t += calculateTax(item);
    });
    setTax(t);
    let s = 0;
    cartList?.forEach((item) => {
      s += calculateShipping(item);
    });
    setShipping(s);
    let sum = 0;
    cartList?.forEach((item) => {
      sum += item.product.pricePerUnit * item.qty;
    });
    setTotal(sum);
  }, [marketplaceDispatch, cartList]);

  const openToast = (placement, isError, msg) => {
    return (
      <ToastComponent
        message={msg}
        success={!isError}
        placement={placement}
      />
    );
  };

  const openToastOrder = (placement) => {
    return (
      <ToastComponent
        message={message}
        success={success}
        placement={placement}
        onClose={() => marketplaceActions.resetMessage(orderDispatch)}
      />
    );
  };

  const columns = [
    {
      title: <Text className="text-primaryC text-[13px]"></Text>,
      dataIndex: "item",
      render: (text) => {
        return (
          <img className="w-16 h-16 object-cover" alt="" src={text.image} />
        );
      },
    },
    {
      title: <Text className="text-primaryC text-[13px]">ITEM</Text>,
      dataIndex: "item",
      render: (text) => {
        return (
          <p className="text-primary text-[17px]">{text.name}</p>
        );
      },
    },
    {
      title: (
        <Text className="text-primaryC text-[13px]">SELLER ORGANIZATION</Text>
      ),
      dataIndex: "sellerOrganization",
      align: "center",
      render: (text) => <p className="text-center">{text}</p>,
      width: "12%"
    },
    {
      title: (
        <Text className="text-primaryC text-[13px]">UNIT OF MEASUREMENT</Text>
      ),
      dataIndex: "unitOfMeasure",
      align: "center",
      render: (text) => (
        <p className="text-center">{UNIT_OF_MEASUREMENTS[text]}</p>
      ),
      width: "12%"
    },
    {
      title: <Text className="text-primaryC text-[13px]">UNIT PRICE($)</Text>,
      dataIndex: "unitPrice",
      align: "center",
      render: (text) => <p className="text-center">{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">QUANTITY</Text>,
      dataIndex: "quantity",
      align: "center",
      width: "160px",
      render: (text) => {
        let qty = 0;
        let product;
        cartList?.forEach((element) => {
          if (element.product.address === text) {
            qty = element.qty;
            product = element.product;
          }
        });
        return (
          <div className="flex items-center mt-2">
            <div
              onClick={() => {
                if (qty === 1) {
                  return;
                }
                let items = [...cartList];
                cartList?.forEach((element, index) => {
                  if (element.product.address === product.address) {
                    if (items[index].qty - 1 <= product.availableQuantity) {
                      items[index].qty -= 1;
                      marketplaceActions.addItemToCart(marketplaceDispatch, items);
                    } else {
                      openToast(
                        "bottom",
                        true,
                        "Cannot add more than available quantity"
                      );
                      return;
                    }
                  }
                });
              }}
              className="h-[32px] w-[27px] pt-1 border border-tertiary text-center cursor-pointer">
              <MinusOutlined className="text-xs text-secondryD" />
            </div>
            <InputNumber className="ml-0.5 h-[32px] w-[77px] border text-primaryC border-tertiary text-center flex flex-col justify-center"
              min={1} value={qty} defaultValue={qty} controls={false}
              onChange={e => {
                let items = [...cartList];
                cartList?.forEach((element, index) => {
                  if (element.product.address === product.address) {
                    if (e <= product?.availableQuantity) {
                      items[index].qty = e;
                      marketplaceActions.addItemToCart(marketplaceDispatch, items);
                    } else {
                      openToast("bottom", true, "Cannot add more than available quantity");
                      items[index].qty = product?.availableQuantity;
                      marketplaceActions.addItemToCart(marketplaceDispatch, items);
                    }
                  }
                });
              }} />
            <div
              onClick={() => {
                let items = [...cartList];
                cartList?.forEach((element, index) => {
                  if (element.product.address === product.address) {
                    if (items[index].qty + 1 <= product.availableQuantity) {
                      items[index].qty += 1;
                      marketplaceActions.addItemToCart(marketplaceDispatch, items);
                    } else {
                      openToast(
                        "bottom",
                        true,
                        "Cannot add more than available quantity"
                      );
                      return;
                    }
                  }
                });
              }}
              className="ml-0.5 h-[32px] w-[27px] pt-1 border border-tertiary text-center cursor-pointer">
              <PlusOutlined className="text-xs text-secondryC" />
            </div>
          </div>
        );
      },
    },
    {
      title: <Text className="text-primaryC text-[13px]">TAX($)</Text>,
      dataIndex: "tax",
      align: "center",
      render: (text) => <p className="text-center">{text}</p>,
    },
    {
      title: (
        <Text className="text-primaryC text-[13px]">SHIPPING CHARGES($)</Text>
      ),
      dataIndex: "shippingCharges",
      align: "center",
      render: (text) => <p className="text-center">{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">AMOUNT($)</Text>,
      dataIndex: "amount",
      align: "center",
      render: (text) => <p className="text-center">{Math.trunc(text)}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">ACTION</Text>,
      dataIndex: "action",
      align: "center",
      render: (text) => (
        <DeleteOutlined
          onClick={() => {
            let items = [...cartList];
            items.splice(
              items.findIndex(function (i) {
                TagManager.dataLayer({
                  dataLayer: {
                    event: 'delete_item_from_cart',
                    product_name: i.product.name,
                    category: i.product.category
                  },
                });
                return i.product.address === text;
              }),
              1
            );
            marketplaceActions.deleteCartItem(marketplaceDispatch, items);
          }}
          className="hover:text-error cursor-pointer text-xl"
        />
      ),
    },
  ];

  const handleOrderConfirm = async () => {
    setOpen(false);
    let orderList = [];
    cartList?.forEach((item) => {
      orderList.push({ inventoryId: item.product.address, quantity: item.qty });
    });
    const body = {
      buyerOrganization: user.organization,
      orderList,
      orderTotal: total + tax + shipping,
      tax: tax,
      shippingCharges: shipping,
    };

    let isDone = await orderActions.createOrder(orderDispatch, body);
    if (isDone) {
      marketplaceActions.addItemToCart(marketplaceDispatch, []);
      setTimeout(function () {
        navigate(`/marketplace`);
      }, 2000);
    }
  };

  return (
    <>
      {isCreateOrderSubmitting
        ? <LoaderComponent />
        : <div>
          <BreadCrumbComponent />
          <div className="h-screen mx-14">
            {
              mapData.length === 0
                ? <NoProductComponent text={"item"} />
                : mapData.map((e, index) => <CartComponent key={index} columns={columns} data={e.value} />)
            }
          </div>
        </div>
      }
      <ConfirmOrderModel
        open={open}
        handleCancel={() => { setOpen(false) }}
        handleConfirm={handleOrderConfirm}
      />
      {message && openToastOrder("bottom")}
    </>
  );
};

export default Checkout;
