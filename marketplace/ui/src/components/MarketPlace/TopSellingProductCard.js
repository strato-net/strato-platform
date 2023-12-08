import React, { useEffect, useState } from "react";
import {
  Typography,
  Spin,
  notification,
} from "antd";
import { actions } from "../../contexts/marketplace/actions";
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from "../../contexts/marketplace";
import { useNavigate } from "react-router-dom";
import routes from "../../helpers/routes";
import { useAuthenticateState } from "../../contexts/authentication";
import NewTrendingCard from "./NewTrendingCard";

const { Title } = Typography;

const TopSellingProductCard = () => {
  const [offset, setOffset] = useState(0);

  const marketplaceDispatch = useMarketplaceDispatch();
  const { topSellingProducts, isTopSellingProductsLoading, cartList } = useMarketplaceState();
  let { hasChecked, isAuthenticated, loginUrl, user } = useAuthenticateState();
  const [api, contextHolder] = notification.useNotification();

  useEffect(() => {
    if (!isAuthenticated) {
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
    if (product.ownerCommonName === user?.commonName) {
      openToast("bottom", true, "Cannot buy your own item")
      return false;
    }
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
      return true;
    } else {
      items = [...cartList];
      cartList.forEach((element, index) => {
        if (element.product.address === product.address) {
          const itemData = JSON.parse(product.data);
          const availableQuantity = itemData.units ? itemData.units : 1;
          if (items[index].qty + 1 <= availableQuantity) {
            items[index].qty += 1;
            actions.addItemToCart(marketplaceDispatch, items);

            openToast("bottom", false, "Item updated in cart");
            return true;
          } else {
            openToast(
              "bottom",
              true,
              "Cannot add more than available quantity"
            );
            return false;
          }
        }
      });
    }
  };

  return (
    <div>
      {contextHolder}
      <Title className="pt-16 md:px-10 !text-xl md:!text-4xl !text-left">Trending in All Categories</Title>
      {isTopSellingProductsLoading ? (
            <div className="h-52 flex justify-center items-center">
              <Spin spinning={isTopSellingProductsLoading} size="large" />
            </div>
          ) : 
      <div className="flex gap-6 p-2 overflow-x-auto trending_cards pl-[1px] md:pl-10">
          {topSellingProducts.map((topSellingProduct)=>{return(
          <NewTrendingCard topSellingProduct={topSellingProduct} />)})}
        </div>}
    </div>
  );
};

export default TopSellingProductCard;