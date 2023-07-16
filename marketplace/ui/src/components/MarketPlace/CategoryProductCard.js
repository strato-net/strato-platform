import {
  Card,
  Image,
  Typography,
  Button,
  notification,
  InputNumber,
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
    TagManager.dataLayer({
      dataLayer: {
        event: 'add_to_cart_from_marketplace',
        product_name: product.name,
        category: product.category
      },
    });
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
    <div>
      {contextHolder}
      <Card
        className="mb-6 cursor-pointer"
      // onClick={() =>
      //   navigate(`${naviroute.replace(":address", product.address)}`)
      // }
      >
        <div className="flex justify-start items-center">
          <div className="m-4">
            <Image
              src={product.imageUrl}
              width={200}
              height={180}
              preview={false}
              onClick={() =>
                navigate(`${naviroute.replace(":address", product.address)}`, { state: { isCalledFromInventory: false } })
              }
            />
          </div>
          <div>
            <div className="flex items-baseline">
              <Text
                strong
                className="text-xl text-primaryB hover:text-primary hover:underline"
                id="prod-name"
                onClick={() =>
                  navigate(`${naviroute.replace(":address", product.address)}`, { state: { isCalledFromInventory: false } })
                }
              >
                {decodeURIComponent(product.name)}&nbsp;
              </Text>
              <Text className="text-secondryB text-sm" id="prod-category">({category})</Text>
            </div>
            <Paragraph
              ellipsis={{ rows: 2, expandable: true, symbol: "more" }}
              className="text-primaryC text-xs mt-2"
              id="prod-desc"
            >
              {decodeURIComponent(product.description)}
            </Paragraph>
            <Title level={4} className="!mt-0" id="prod-price">
              $ {product.pricePerUnit}
            </Title>
            <div className="flex items-center my-2" id="prod-quantity">
              <Text className="text-primaryB text-base">Quantity</Text>
              <div className="ml-5 flex items-center my-2" id="prod-quantity">
                <div
                  onClick={subtract}
                  className="h-[32px] w-[27px] pt-1 border border-tertiary text-center cursor-pointer">
                  <MinusOutlined className="text-xs text-secondryD" />
                </div>
                <InputNumber className="ml-0.5 h-[32px] w-[77px] border text-primaryC border-tertiary text-center flex flex-col justify-center" min={1} max={product.availableQuantity} value={qty} defaultValue={qty} controls={false}
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
                  }} />
                <div
                  onClick={add}
                  className="ml-0.5 h-[32px] w-[27px] pt-1 border border-tertiary text-center cursor-pointer">
                  <PlusOutlined className="text-xs text-secondryC" />
                </div>
              </div>
            </div>
            <Button
              className="group w-40 h-9 border border-primary hover:bg-primary"
              onClick={() => {
                if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                  window.location.href = loginUrl;
                } else {
                  addItemToCart();
                }
              }}>
              <div className="text-primary group-hover:text-white">Add To Cart</div>
            </Button>
            <Button
              type="primary"
              id={`${product.name.replace(/ /g,"_")}-buy-now`}
              className="w-40 h-9 m-3 bg-primary !hover:bg-primaryHover"
              onClick={() => {
                if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                  window.location.href = loginUrl;
                } else {
                  addItemToCart();
                  navigate("/checkout");
                }
              }}
            >
              Buy Now
            </Button>
          </div>
        </div>
      </Card >
    </div >
  );
};

export default CategoryProductCard;
