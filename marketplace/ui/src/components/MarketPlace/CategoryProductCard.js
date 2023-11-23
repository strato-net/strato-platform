import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import TagManager from "react-gtm-module";
import {
  Card,
  Image,
  Typography,
  Button,
  notification,
  InputNumber,
} from "antd";
import { MinusOutlined, PlusOutlined } from "@ant-design/icons";

// Actions
import { actions as marketplaceActions } from "../../contexts/marketplace/actions";

// Dispatch and states
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from "../../contexts/marketplace";
import { useAuthenticateState } from "../../contexts/authentication";

import { setCookie } from "../../helpers/cookie";
import noPreview from "../../images/resources/noPreview.jpg";

const { Title, Text, Paragraph } = Typography;

const CategoryProductCard = ({ product }) => {
  const {
    availableQuantity,
    address,
    name,
    productImageLocation,
    membershipId,
    category,
    productId,
    pricePerUnit,
    totalSavings,
    description,
  } = product;

  const navigate = useNavigate();

  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
  const { cartList } = useMarketplaceState();

  const marketplaceDispatch = useMarketplaceDispatch();

  useEffect(() => {
    marketplaceActions.fetchCartItems(marketplaceDispatch, cartList);
  }, [marketplaceDispatch, cartList]);

  const [api, contextHolder] = notification.useNotification();
  const [qty, setQty] = useState(1);

  const subtract = () => {
    if (qty !== 1) {
      let value = qty - 1;
      setQty(value);
    }
  };

  const add = () => {
    if (qty < availableQuantity) {
      let value = qty + 1;
      setQty(value);
    } else {
      openToast("bottom", true, "Cannot add more than available quantity");
    }
  };

  const openToast = (placement, isError, msg) => {
    const toastFunction = isError ? api.error : api.success;

    toastFunction({
      message: msg,
      placement,
      key: 1,
    });
  };

  const addItemToCart = () => {
    let found = false;
    for (var i = 0; i < cartList?.length; i++) {
      if (cartList[i].product.address === address) {
        found = true;
        break;
      }
    }
    let items = [];
    if (!found) {
      items = [...cartList, { product, qty }];
      marketplaceActions.addItemToCart(marketplaceDispatch, items);
      openToast("bottom", false, "Item added to cart");
    } else {
      items = [...cartList];
      cartList.forEach((element, index) => {
        if (element.product.address === address) {
          if (items[index].qty + qty <= availableQuantity) {
            items[index].qty += qty;
            marketplaceActions.addItemToCart(marketplaceDispatch, items);
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

  let route = `/memberships/all/${membershipId}?inventoryId=${address}`;
  const handleRedirect = () => {
    setCookie("returnUrl", `/marketplace${route}`, 10);
    navigate(route);
  };

  const handleButtonClick = (event, isNavigate) => {
    if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
      setCookie("returnUrl", `/marketplace${route}`, 10);
      window.location.href = loginUrl;
    } else {
      TagManager.dataLayer({
        dataLayer: {
          event: event,
          product_name: name,
          category: category,
          productId: productId,
        },
      });
      addItemToCart();
      isNavigate && navigate("/checkout");
    }
  };

  return (
    <div>
      {contextHolder}
      <Card className="mb-6 cursor-pointer">
        <div className="flex justify-start items-center">
          <div className="m-4">
            <Image
              src={productImageLocation[0]}
              width={200}
              height={180}
              preview={false}
              fallback={noPreview}
              onClick={handleRedirect}
            />
          </div>
          <div>
            <div className="flex items-baseline">
              <Text
                strong
                className="text-xl text-primaryB hover:text-primary hover:underline"
                id="prod-name"
                onClick={handleRedirect}
              >
                {name}&nbsp;
              </Text>
            </div>
            <Paragraph
              ellipsis={{ rows: 2, expandable: true, symbol: "more" }}
              className="text-primaryC text-xs mt-2"
              id="prod-desc"
            >
              {description}
            </Paragraph>
            <Title level={4} className="!mt-0" id="prod-price">
              ${pricePerUnit}
            </Title>
            <Title
              level={4}
              className="!mt-0"
              id="prod-savings"
              style={{ color: "green" }}
            >
              Total Savings: ${totalSavings}
            </Title>
            {availableQuantity !== 0 ? (
              <div>
                <div className="flex items-center my-2" id="prod-quantity">
                  <Text className="text-primaryB text-base">Quantity</Text>
                  <div
                    className="ml-5 flex items-center my-2"
                    id="prod-quantity"
                  >
                    <div
                      onClick={subtract}
                      className="h-[32px] w-[27px] pt-1 border border-tertiary text-center cursor-pointer"
                    >
                      <MinusOutlined className="text-xs text-secondryD" />
                    </div>
                    <InputNumber
                      className="ml-0.5 h-[32px] w-[77px] border text-primaryC border-tertiary text-center flex flex-col justify-center"
                      min={1}
                      max={availableQuantity}
                      value={qty}
                      defaultValue={qty}
                      controls={false}
                      onChange={(selectedQuantity) => {
                        if (selectedQuantity < availableQuantity) {
                          setQty(selectedQuantity);
                        } else {
                          openToast(
                            "bottom",
                            true,
                            "Cannot add more than available quantity"
                          );
                          setQty(availableQuantity);
                        }
                      }}
                    />
                    <div
                      onClick={add}
                      className="ml-0.5 h-[32px] w-[27px] pt-1 border border-tertiary text-center cursor-pointer"
                    >
                      <PlusOutlined className="text-xs text-secondryC" />
                    </div>
                  </div>
                </div>
                <Button
                  className="group w-40 h-9 border border-primary hover:bg-primary"
                  onClick={() => {
                    handleButtonClick("add_to_cart_from_marketplace", false);
                  }}
                >
                  <div className="text-primary group-hover:text-white">
                    Add To Cart
                  </div>
                </Button>
                <Button
                  type="primary"
                  id={`${name.replace(/ /g, "_")}-buy-now`}
                  className="w-40 h-9 m-3 bg-primary !hover:bg-primaryHover"
                  onClick={() => {
                    handleButtonClick("buy_now_from_marketplace", true);
                  }}
                >
                  Buy Now
                </Button>
              </div>
            ) : (
              /* When there isnt avalialable quantity for the item */
              <div>
                <Button
                  type="primary"
                  className="w-40 h-9 m-3 bg-primary !hover:bg-primaryHover"
                  href={`mailto:sales@blockapps.net`}
                  onClick={() => {
                    TagManager.dataLayer({
                      dataLayer: {
                        event: "contact_sales_from_category_card",
                        product_name: name,
                        category,
                        productId,
                      },
                    });
                  }}
                >
                  Contact to Buy
                </Button>
                <Paragraph
                  style={{ color: "red", fontSize: 14 }}
                  className="!mt-0"
                  id="prod-price"
                >
                  If you are interested in purchasing this item, please contact
                  our sales team at sales@blockapps.net
                </Paragraph>
              </div>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
};

export default CategoryProductCard;
