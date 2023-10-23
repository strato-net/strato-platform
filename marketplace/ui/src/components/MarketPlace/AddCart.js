import {
  Breadcrumb,
  Typography,
  notification,
  Spin,
  Image,
  InputNumber
} from "antd";
import { MinusOutlined, PlusOutlined } from "@ant-design/icons";
import {
  useMarketplaceState,
  useMarketplaceDispatch,
} from "../../contexts/marketplace";
import { useNavigate } from "react-router-dom";
import { useOrderState, useOrderDispatch } from "../../contexts/order";
import { actions } from "../../contexts/marketplace/actions";
import { actions as orderActions } from "../../contexts/order/actions";
import { Images } from "../../images";
import { useState, useEffect, useMemo } from "react";
import { DeleteOutlined } from "@ant-design/icons";
import "./index.css";
import ConfirmOrderModel from "./ConfirmOrderModel";
import { CHARGES, UNIT_OF_MEASUREMENTS } from "../../helpers/constants";
import ClickableCell from "../ClickableCell";
import routes from "../../helpers/routes";
import CartComponent from "./CartComponent";
import TagManager from "react-gtm-module";
import BreadCrumbComponent from "../BreadCrumb/BreadCrumbComponent";

const { Title, Text } = Typography;

const Checkout = ({ user }) => {
  const [open, setOpen] = useState(false);
  const marketplaceDispatch = useMarketplaceDispatch();
  const orderDispatch = useOrderDispatch();
  const [api, contextHolder] = notification.useNotification();
  const { cartList } = useMarketplaceState();
  const { isCreateOrderSubmitting, message, success } = useOrderState();

  const [tax, setTax] = useState(0);
  const [shipping, setShipping] = useState(0);
  const [total, setTotal] = useState(0);
  const [mapData, setmapData] = useState([])

  const handleCancel = () => {
    setOpen(false);
  };

  const calculateTax = (item) => {
    return item.product.taxes ?
      (item.product.isTaxPercentage ?
        (Math.ceil((item.product.pricePerUnit * item.qty * item.product.taxes) * 100) / 100).toFixed(2)
        : (item.product.taxes / 100) * item.qty)
      : 0;
  };

  const calculateShipping = (item) => {
    return (item.product.pricePerUnit * item.qty * CHARGES.SHIPPING) / 100;
  };

  let storedData
  useEffect(() => {
    let cartData = window.localStorage.getItem("cartList");
    if (cartData) {
      storedData = JSON.parse(cartData);
    }
    // return JSON.parse(cartData ?? "");
  }, [window.localStorage.getItem("cartList")]);

  useEffect(() => {
    actions.fetchCartItems(marketplaceDispatch, storedData);
  }, [marketplaceDispatch, storedData]);

  useEffect(() => {
    const map = new Map();
    for (const obj of cartList) {
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
        modifiedValue.push({
          key: item.product.address,
          item: {
            name: item.product.name,
            image: item.product.imageUrl,
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
            item.product.pricePerUnit * item.qty,
          action: item.product.address,
          qty: item.qty,
        });
      });

      // Return the new object
      return { key: key, value: modifiedValue };
    });
    setmapData(mapDataArray)

    let t = 0;
    cartList.forEach((item) => {
      t += calculateTax(item);
    });
    setTax(t);
    let s = 0;
    cartList.forEach((item) => {
      s += calculateShipping(item);
    });
    setShipping(s);
    let sum = 0;
    cartList.forEach((item) => {
      sum += item.product.pricePerUnit * item.qty;
    });
    setTotal(sum);
  }, [marketplaceDispatch, cartList]);

  const openToast = (placement, isError, msg) => {
    if (isError) {
      api.error({
        message: msg,
        placement,
        key: 1,
      });
    } else {
      api.success({
        message: msg,
        placement,
        key: 1,
      });
    }
  };

  const openToastOrder = (placement) => {
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
          <p className="text-primary text-[17px]">{decodeURIComponent(text.name)}</p>
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
        cartList.forEach((element) => {
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
                cartList.forEach((element, index) => {
                  if (element.product.address === product.address) {
                    if (items[index].qty - 1 <= product.availableQuantity) {
                      items[index].qty -= 1;
                      actions.addItemToCart(marketplaceDispatch, items);
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
                cartList.forEach((element, index) => {
                  if (element.product.address === product.address) {
                    if (e <= product?.availableQuantity) {
                      items[index].qty = e;
                      actions.addItemToCart(marketplaceDispatch, items);
                    } else {
                      openToast("bottom", true, "Cannot add more than available quantity");
                      items[index].qty = product?.availableQuantity;
                      actions.addItemToCart(marketplaceDispatch, items);
                    }
                  }
                });
              }} />
            <div
              onClick={() => {
                let items = [...cartList];
                cartList.forEach((element, index) => {
                  if (element.product.address === product.address) {
                    if (items[index].qty + 1 <= product.availableQuantity) {
                      items[index].qty += 1;
                      actions.addItemToCart(marketplaceDispatch, items);
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
      render: (text) => <p className="text-center">{text}</p>,
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
            actions.deleteCartItem(marketplaceDispatch, items);
          }}
          className="hover:text-error cursor-pointer text-xl"
        />
      ),
    },
  ];


  const navigate = useNavigate();

  const handleOrderConfirm = async () => {
    handleCancel();
    let orderList = [];
    cartList.forEach((item) => {
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
      actions.addItemToCart(marketplaceDispatch, []);
      setTimeout(function () {
        navigate(`/marketplace`);
      }, 2000);
    }
  };

  return (
    <div className="h-screen mx-14">
      {contextHolder}
      {isCreateOrderSubmitting ? (
        <div className="h-screen flex justify-center items-center">
          <Spin spinning={isCreateOrderSubmitting} size="large" />
        </div>
      ) : (
        <div>
          <BreadCrumbComponent />
          {
            mapData.length === 0 ? <div className="h-screen justify-center flex flex-col items-center">
              <Image src={Images.noProductSymbol} preview={false} />
              <Title level={3} className="mt-2">
                No item found
              </Title>
            </div> : mapData.map(e => <CartComponent columns={columns} data={e.value} />)
          }
        </div>
      )}
      <ConfirmOrderModel
        open={open}
        handleCancel={handleCancel}
        handleConfirm={handleOrderConfirm}
      />
      {message && openToastOrder("bottom")}
    </div>
  );
};

export default Checkout;