import React from "react";
import {
  Card,
  Image,
  Typography,
  Button,
  notification,
  InputNumber,
  Col,
  Row,
  Input,
} from "antd";
import { MinusOutlined, PlusOutlined } from "@ant-design/icons";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import routes from "../../helpers/routes";
import { actions } from "../../contexts/marketplace/actions";
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from "../../contexts/marketplace";
import { useAuthenticateState } from "../../contexts/authentication";
import TagManager from "react-gtm-module";
import { purpleCheckIcon, whiteCartIcon } from "../../images/SVGComponents";


const { Title, Text, Paragraph } = Typography;


const CategoryProductCard = ({ product, category }) => {
  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
  const marketplaceDispatch = useMarketplaceDispatch();
  const { cartList } = useMarketplaceState();

  // const storedData = useMemo(() => {
  //   return JSON.parse(window.localStorage.getItem("cartList") ?? []);
  // }, []);

  useEffect(() => {
    actions.fetchCartItems(marketplaceDispatch, cartList);
  }, [marketplaceDispatch, cartList]);

  const [api, contextHolder] = notification.useNotification();

  const navigate = useNavigate();
  const naviroute = routes.MarketplaceProductDetail.url;
  const [qty, setQty] = useState(1);

  const subtract = () => {
    if (qty !== 1) {
      let value = qty - 1;
      setQty(value);
    }
  };

  const add = () => {
    if (qty < product.availableQuantity) {
      let value = qty + 1;
      setQty(value);
    } else {
      openToast("bottom", true, "Cannot add more than available quantity");
    }
  };

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

  const addItemToCart = () => {
    let found = false;
    for (var i = 0; i < cartList.length; i++) {
      if (cartList[i].product.address === product.address) {
        found = true;
        break;
      }
    }
    let items = [];
    if (!found) {
      items = [...cartList, { product, qty }];
      actions.addItemToCart(marketplaceDispatch, items);
      openToast("bottom", false, "Item added to cart");
    } else {
      items = [...cartList];
      cartList.forEach((element, index) => {
        if (element.product.address === product.address) {
          if (items[index].qty + qty <= product.availableQuantity) {
            items[index].qty += qty;
            actions.addItemToCart(marketplaceDispatch, items);
            setQty(1);
            openToast("bottom", false, "Item updated in cart");
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
    }
  };

  return (
    <>
      {contextHolder}
      <Col sm={12} lg={8} xl={7} className="p-4 bg-white rounded-lg shadow-lg category-card">
        <Image
          width={'100%'}
          height={200}
          preview={false}
          className="rounded-md cursor-pointer object-cover"
          src={product.imageUrl}
          fallback={'https://i.stack.imgur.com/Q3vyk.png'}
          onClick={() =>
            navigate(`${naviroute.replace(":address", product.address)}`, { state: { isCalledFromInventory: false } })
          }
        />
        <Row className="flex cursor-pointer"
          onClick={() =>
            navigate(`${naviroute.replace(":address", product.address)}`, { state: { isCalledFromInventory: false } })
          }
        >
          <Title level={4}>
            {decodeURIComponent(product.name)}  </Title> {purpleCheckIcon()} </Row>
        <Text className="block dollar-text" strong>$ {product.pricePerUnit} </Text>
        <Paragraph> {decodeURIComponent(product.description).replace(/%0A/g, "\n").split('\n').map((line, index) => (
          <React.Fragment key={index}>
            {line}
            <br />
          </React.Fragment>
        ))}</Paragraph>
        <Row className="rounded-md p-2 theme-bg qty-btn">
          <Col span={14}><Text className="block mt-2 text-center">Quantity</Text></Col>
          <Col span={10} className="flex justify-between rounded-md bg-white p-1">
            <Button className="w-10" onClick={subtract}>
              <MinusOutlined className="text-xs text-black" />
            </Button>

            {/* <Input className="w-16"
            onChange={e => {
                          if (e < product.availableQuantity) {
                            setQty(e)
                          } else {
                            openToast(
                              "bottom",
                              true,
                              "Cannot add more than available quantity"
                            );
                            setQty(product.availableQuantity)
                          }
                        }} 
            /> */}
            <Text className="block text-center pt-1" strong> {qty}</Text>

            <Button className="w-10" onClick={add}>
              <PlusOutlined className="text-xs text-black" />
            </Button>
          </Col>
        </Row>

        <Row className='mt-4 buy-btn'>
          <Col span={18} className='bg-primary h-10 rounded-md'>
            <Text strong className='block text-white mt-2 text-center'
              onClick={() => {
                if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                  window.location.href = loginUrl;
                } else {
                  TagManager.dataLayer({
                    dataLayer: {
                      event: 'buy_now_from_marketplace',
                      product_name: product.name,
                      category: product.category,
                      productId: product.productId
                    },
                  });
                  addItemToCart();
                  navigate("/checkout");
                }
              }}
            > Buy Now </Text>
          </Col>
          <Col span={4} offset={2} className='bg-primary h-10 p-3 pl-3 flex justify-between rounded-md'
            onClick={() => {
              if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                window.location.href = loginUrl;
              } else {
                TagManager.dataLayer({
                  dataLayer: {
                    event: 'add_to_cart_from_marketplace',
                    product_name: product.name,
                    category: product.category,
                    productId: product.productId
                  },
                });
                addItemToCart();
              }
            }}
          >
            <div className='mx-auto'>
              {whiteCartIcon()}
            </div>
          </Col>
        </Row>
      </Col>

    </>
  );
};

export default CategoryProductCard;