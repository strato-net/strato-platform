import React from "react";
import {
  Breadcrumb,
  Typography,
  notification,
  Spin,
  Image,
  InputNumber,
  Button,
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
//   import { DeleteOutlined } from "@ant-design/icons";
import "./index.css";
import ConfirmOrderModel from "./ConfirmOrderModel";
import { CHARGES, UNIT_OF_MEASUREMENTS } from "../../helpers/constants";
import ClickableCell from "../ClickableCell";
import routes from "../../helpers/routes";
import CartComponent from "./CartComponent";
import TagManager from "react-gtm-module";
import image_placeholder from "../../images/resources/image_placeholder.png";
import ResponsiveCart from "./ResponsiveCart";

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
  const [mapData, setmapData] = useState([]);

  const handleCancel = () => {
    setOpen(false);
  };

  const calculateTax = (item) => {
    return (item.product.price * CHARGES.TAX) / 100;
  };

  const calculateShipping = (item) => {
    return (item.product.price * CHARGES.SHIPPING) / 100;
  };

  const storedData = useMemo(() => {
    const cartListData = window.localStorage.getItem("cartList");
    let cartList = [];

    try {
      if (cartListData) {
        // Attempt to parse the stored data as JSON
        cartList = JSON.parse(cartListData);
      }
    } catch (error) {
      // Handle JSON parsing error
      console.error("Error parsing cartList data:", error);
    }

    return cartList;
  }, []);

  useEffect(() => {
    actions.fetchCartItems(marketplaceDispatch, storedData);
  }, [marketplaceDispatch, storedData]);

  useEffect(() => {
    const map = new Map();
    for (const obj of cartList) {
      const org = obj.product.ownerCommonName;
      if (!map.has(org)) {
        map.set(org, []);
      }
      map.get(org).push(obj);
    }
    const mapDataArray = Array.from(map, (entry, index) => {
      // Modify the values and keys as needed
      const [key, value] = entry;
      let modifiedValue = [];
      value.forEach((item) => {
        const parts = item.product.contract_name.split("-");

        modifiedValue.push({
          key: item.product.address,
          item: {
            name: item.product.name,
            image:
              item.product.images && item.product.images.length > 0
                ? item.product.images[0]
                : image_placeholder,
            status: "Active",
          },
          category: parts[parts.length - 1],
          firstSale: item.product.address === item.product.originAddress? true: false,
          sellersCommonName: item.product.ownerCommonName,
          unitOfMeasure: item.product.unitOfMeasurement,
          unitPrice: item.product.price,
          quantity: item.product.saleQuantity,
          saleAddress: item.product.saleAddress,
          tax: calculateTax(item),
          shippingCharges: calculateShipping(item),
          amount:
            item.product.price * item.qty +
            calculateShipping(item) +
            calculateTax(item),
          action: item.product.address,
          qty: item.qty,
        });
      });

      // Return the new object
      return { key: key, value: modifiedValue };
    });
    setmapData(mapDataArray);
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
      sum += item.product.price;
    });
    setTotal(sum);
  }, [marketplaceDispatch, cartList]);

  const MinusQty = (qty, product) => {
    if (qty === 1) {
      return;
    }

    let items = [...cartList];
    cartList.forEach((element, index) => {
      if (element.product.address === product.key) {
        const availableQuantity = product.quantity ? product.quantity : 1;
        if (items[index].qty - 1 <= availableQuantity) {
          items[index].qty -= 1;
          actions.addItemToCart(marketplaceDispatch, items);
        }
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
          "ready",
          async (LO) => {
            // Track an event
            await LO.$internal.ready("events");
            LO.events.track("Delete Cart Item", {
              product: i.product.name,
              category: i.product.category,
            });
          },
        ]);
        TagManager.dataLayer({
          dataLayer: {
            event: "delete_item_from_cart",
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
    let items = [...cartList];
    cartList.forEach((element, index) => {
      if (element.product.address === product.key) {
        const availableQuantity = product.quantity ? product.quantity : 1;
        if (e <= availableQuantity) {
          items[index].qty = e;
          actions.addItemToCart(marketplaceDispatch, items);
        } else {
          items[index].qty = availableQuantity;
          actions.addItemToCart(marketplaceDispatch, items);
        }
      }
    });
  };
  
  // const openToast = (placement, isError, msg) => {
  //   if (isError) {
  //     api.error({
  //       message: msg,
  //       placement,
  //       key: 1,
  //     });
  //   } else {
  //     api.success({
  //       message: msg,
  //       placement,
  //       key: 1,
  //     });
  //   }
  // };

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
      dataIndex: "item",
        width:"230px",
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
      dataIndex: "sellersCommonName",
      align: "center",
      render: (text) => (
        <p className="text-center font-semibold text-sm">{text}</p>
      ),
      // width: "12%"
    },
    {
      title: (
        <Text className="text-[#202020] text-base font-semibold">
          Unit Price($)
        </Text>
      ),
      dataIndex: "unitPrice",
      align: "center",
      render: (text) => (
        <p className=" text-sm text-[#202020] font-semibold font-sans">
          {"$" + text}
        </p>
      ),
    },
    {
      title: (
        <Text className="text-[#202020] text-base font-semibold">Quantity</Text>
      ),
      dataIndex: "quantity",
      align: "center",
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
              style={{ background: "transparent" }}
              className="w-[43px] border-none text-[#202020]  font-semibold text-sm text-center flex flex-col justify-center"
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
      title: (
        <Text className="text-[#202020] text-base font-semibold">
          Shipping Charges
        </Text>
      ),
      dataIndex: "shippingCharges",
      align: "center",

      render: (text) => (
        <p className="text-sm font-semibold text-[#202020] ">{"$" + text}</p>
      ),
    },
    {
      title: (
        <Text className="text-[#202020] text-base font-semibold">Tax($)</Text>
      ),
      dataIndex: "tax",
      align: "center",
      render: (text) => (
        <p className="text-sm font-semibold text-[#202020]">{"$" + text}</p>
      ),
    },
    {
      title: (
        <Text className="text-[#202020] text-base font-semibold">
          Amount($)
        </Text>
      ),
      dataIndex: "amount",
      align: "center",
      render: (text) => (
        <p className="text-sm font-semibold text-[#202020]">{"$" + text}</p>
      ),
    },
    {
      title: <Text className="text-[#202020] text-base font-semibold "></Text>,
      dataIndex: "action",
      align: "",
      width:"4%",
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

  const navigate = useNavigate();

  const handleOrderConfirm = async () => {
    handleCancel();
    let orderList = [];
    cartList.forEach((item) => {
      orderList.push({ inventoryId: item.product.address, quantity: item.qty });
    });
    const body = {
      buyerCommonName: user.commonName,
      orderList,
      orderTotal: total + tax + shipping,
    };

    let isDone = await orderActions.createOrder(orderDispatch, body);
    if (isDone) {
      actions.addItemToCart(marketplaceDispatch, []);
      setTimeout(function () {
        navigate(`/`);
      }, 2000);
    }
  };

  return (
    <div className="h-screen  mx-4 my-2 lg:mx-8 xl:mx-14   ">
      {contextHolder}
      {isCreateOrderSubmitting ? (
        <div className="h-screen flex justify-center items-center">
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
              <p className="text-sm text-[#202020] font-medium">My Cart</p>
            </Breadcrumb.Item>
          </Breadcrumb>

          <div className=" pt-[18px] lg:pt-6 ">
            <p className=" text-base md:text-xl lg:text-2xl font-bold lg:font-semibold leading-9">
              My Cart
            </p>
          </div>
          <div className="grid grid-cols-1 sm:place-items-center   gap-3 lg:block ">
            {mapData.length === 0 ? (
              <div className="h-screen justify-center flex flex-col  items-center">
                <Image src={Images.noProductSymbol} preview={false} />
                <Title level={3} className="mt-2">
                  No item found
                </Title>
              </div>
            ) : (
              mapData.map((e, index) => (
                <React.Fragment key={e.key}>
                  <div
                    className={`hidden  lg:block ${index === 0 ? "" : "mt-10"}`}
                  >
                    <CartComponent columns={columns} data={e.value} openToastOrder={openToastOrder}/>{" "}
                  </div>{" "}
                  <div className="lg:hidden">
                    <ResponsiveCart
                      data={e.value}
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
      <ConfirmOrderModel
        open={open}
        handleCancel={handleCancel}
        handleConfirm={handleOrderConfirm}
      />
      {message && openToastOrder("bottom", message)}
    </div>
  );
};

export default Checkout;
