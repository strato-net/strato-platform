import React, { useEffect, useState } from "react";
import {
  Card,
  Typography,
  Image,
  Space,
  Button,
  Spin,
  notification,
} from "antd";
import { LeftArrow, RightArrow } from "../../images/SVGComponents";
import { Cart } from "../../images/SVGComponents";
import { actions } from "../../contexts/marketplace/actions";
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from "../../contexts/marketplace";
import { UNIT_OF_MEASUREMENTS } from "../../helpers/constants";
import { useNavigate } from "react-router-dom";
import routes from "../../helpers/routes";
import { useAuthenticateState } from "../../contexts/authentication";
import TagManager from "react-gtm-module";

const { Title, Text } = Typography;

const TopSellingProductCard = () => {
  const [offset, setOffset] = useState(0);

  const marketplaceDispatch = useMarketplaceDispatch();
  const { topSellingProducts, isTopSellingProductsLoading, cartList } = useMarketplaceState();
  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
  const [api, contextHolder] = notification.useNotification();

  useEffect(() => {
    if (hasChecked && !isAuthenticated) {
      actions.fetchTopSellingProducts(marketplaceDispatch, offset);
    } else {
      actions.fetchTopSellingProductsLoggedIn(marketplaceDispatch, offset);
    }
  }, [marketplaceDispatch, offset, hasChecked, isAuthenticated, loginUrl]);

  const naviroute = routes.MarketplaceProductDetail.url;

  const limit = 3;

  const getPrevProds = () => {
    if (offset > 0) setOffset(offset - limit);
  };

  const getNextProds = () => {
    if (offset !== 9) {
      setOffset(offset + limit);
    }
  };

  const navigate = useNavigate();

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

  const addItemToCart = (product) => {
    let found = false;
    for (var i = 0; i < cartList.length; i++) {
      if (cartList[i].product.address === product.address) {
        found = true;
        break;
      }
    }
    let items = [];
    if (!found) {
      items = [...cartList, { product, qty: 1 }];
      actions.addItemToCart(marketplaceDispatch, items);

      openToast("bottom", false, "Item added to cart");
    } else {
      items = [...cartList];
      cartList.forEach((element, index) => {
        if (element.product.address === product.address) {
          if (items[index].qty + 1 <= product.availableQuantity) {
            items[index].qty += 1;
            actions.addItemToCart(marketplaceDispatch, items);

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
      <Card className="w-full mt-14">
        <div className="flex justify-between mb-5">
          <Title level={3}>Recently Listed Products</Title>
          <Space size="large">
            <div
              onClick={getPrevProds}
              className="cursor-pointer w-9 h-9 rounded-full shadow-[0px_0px_2px_0_rgba(0,0,0,0.3)] flex justify-center items-center"
            >
              <LeftArrow />
            </div>
            <div
              onClick={getNextProds}
              className="cursor-pointer w-9 h-9 rounded-full shadow-[0px_0px_2px_0_rgba(0,0,0,0.3)] flex justify-center items-center"
            >
              <RightArrow />
            </div>
          </Space>
        </div>
        <div className="flex justify-evenly px-2" id="topSelling">
          {isTopSellingProductsLoading ? (
            <div className="h-52 flex justify-center items-center">
              <Spin spinning={isTopSellingProductsLoading} size="large" />
            </div>
          ) : (
            topSellingProducts
              .map((topSellingProduct, index) => {
                return (
                  <div
                    key={index}
                    id="topSellingChild"
                    className="w-[25rem] border border-tertiaryB rounded-md py-8 mx-6"
                  >
                    <div className="flex flex-col items-center">
                      <Image
                        className="cursor-pointer"
                        src={topSellingProduct.imageUrl}
                        height={230}
                        width={230}
                        style={{ objectFit: "contain" }}
                        preview={false}
                        onClick={() =>
                          navigate(`${naviroute.replace(":address", topSellingProduct.address)}`, { state: { isCalledFromInventory: false } })
                        }
                      />
                      <Text className="mt-6 text-2xl !text-primaryB font-medium text-center cursor-pointer" onClick={() =>
                        navigate(`${naviroute.replace(":address", topSellingProduct.address)}`, { state: { isCalledFromInventory: false } })
                      }>
                        {decodeURIComponent(topSellingProduct.name)}
                      </Text>
                      <Text className="mt-3 text-xl !text-primaryC font-semibold">
                        ${topSellingProduct.pricePerUnit}
                      </Text>
                      <Text className="mt-1 text-sm !text-primaryB">
                        {topSellingProduct.leastSellableUnit}{" "}
                        {
                          UNIT_OF_MEASUREMENTS[
                          topSellingProduct.unitOfMeasurement
                          ]
                        }
                      </Text>
                      <div className="flex justify-evenly items-center mt-4 w-full px-3">
                        <Button
                          id={`${topSellingProduct.name.replace(/ /g, "_")}-buy-now`}
                          className="h-11 bg-primary hover:bg-primaryHover !text-white w-9/12"
                          onClick={() => {
                            if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                              window.location.href = loginUrl;
                            } else {
                              TagManager.dataLayer({
                                dataLayer: {
                                  event: 'buy_now_from_top_selling_product',
                                  product_name: topSellingProduct.name,
                                  category: topSellingProduct.category,
                                  productId: topSellingProduct.productId
                                },
                              });
                              addItemToCart(topSellingProduct);
                              navigate("/checkout");
                            }
                          }}
                        >
                          Buy now
                        </Button>
                        <div
                          onClick={() => {
                            if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                              window.location.href = loginUrl;
                            } else {
                              TagManager.dataLayer({
                                dataLayer: {
                                  event: 'add_to_cart_from_top_selling_product',
                                  product_name: topSellingProduct.name,
                                  category: topSellingProduct.category,
                                  productId: topSellingProduct.productId
                                },
                              });
                              addItemToCart(topSellingProduct);
                            }
                          }}
                          className="w-11 h-10 border border-primary rounded-md flex justify-center items-center cursor-pointer"
                        >
                          <Cart style={{ fill: "#181EAC" }} />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })
              .splice(0, 3)
          )}
        </div>
      </Card>
    </div>
  );
};

export default TopSellingProductCard;