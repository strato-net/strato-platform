import React, { useEffect, useRef, useState } from "react";
import {
  Typography,
  Spin,
  notification,
  Button,
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
import { actions as orderActions } from "../../contexts/order/actions"
import { useOrderDispatch, useOrderState} from "../../contexts/order";

const { Title } = Typography;

const TopSellingProductCard = () => {
  const containerRef = useRef(null)
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const marketplaceDispatch = useMarketplaceDispatch();
  const { topSellingProducts, isTopSellingProductsLoading, cartList } = useMarketplaceState();
  let { hasChecked, isAuthenticated, loginUrl, user } = useAuthenticateState();
  const [api, contextHolder] = notification.useNotification();

  const orderDispatch = useOrderDispatch();
  const { saleQuantity, saleQuantityLoading } = useOrderState()

  useEffect(() => {
      orderActions.fetchSaleQuantity(orderDispatch, ['015ae9a7641a45cedc5fc547d480cc9bd164fb4d', 'd50c8c309ee2eed5fcf76cb85e62bfc0cdc53d53'], [2, 3]);
    }, [orderDispatch]);
  console.log("saleQuantities", saleQuantity, saleQuantityLoading)

  useEffect(() => {
    if (!isAuthenticated) {
      actions.fetchTopSellingProducts(marketplaceDispatch, offset, limit);
    } else {
      actions.fetchTopSellingProductsLoggedIn(marketplaceDispatch, offset, limit);
    }
  }, [marketplaceDispatch, offset, hasChecked, isAuthenticated, loginUrl]);

  const naviroute = routes.MarketplaceProductDetail.url;


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

  const addItemToCart = (product, quantity) => {
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
      items = [...cartList, { product, qty: quantity }];
      actions.addItemToCart(marketplaceDispatch, items);

      openToast("bottom", false, "Item added to cart");
      return true;
    } else {
      items = [...cartList];
      cartList.forEach((element, index) => {
        if (element.product.address === product.address) {
          const availableQuantity = product.saleQuantity ? product.saleQuantity : 1;
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

  const [prevVisible, setPrevVisible] = useState(false);
  const [nextVisible, setNextVisible] = useState(true);

  useEffect(() => {
    const parent = containerRef.current;
    const handleScroll = (e) => {
      setPrevVisible(parent.scrollLeft !== 0);
      setNextVisible(
        Math.round(parent.offsetWidth + parent.scrollLeft) !==
          parent.scrollWidth
      );
    };

    // Scroll listener to change visibility of left and right arrow button
    parent?.addEventListener("scroll", handleScroll);
    return () => {
      parent?.removeEventListener("scroll", handleScroll);
    };
  }, [topSellingProducts]);

  const scroll = (left) => {
    containerRef.current.scrollBy({
      top: 0,
      left,
      behavior: "smooth",
    });
  };


  return (
    <div>
      {contextHolder}
      <div className="pt-10 md:pt-16 pr-2 md:pr-10 flex justify-between">
        <Title className="md:px-10 !text-xl md:!text-4xl !text-left">
          Trending in All Categories
        </Title>
        <Button 
          size="large" 
          onClick={()=>navigate(routes.MarketplaceProductList.url)}
          className="text-black hover:!text-black border-grayDark hidden md:flex"
        >
            View All
        </Button>
        <Button 
          size="small" 
          onClick={()=>navigate(routes.MarketplaceProductList.url)}
          className="text-black hover:!text-black border-grayDark flex md:hidden"
        >
            View All
        </Button>
      </div>
      {isTopSellingProductsLoading ? (
            <div className="h-52 flex justify-center items-center">
              <Spin spinning={isTopSellingProductsLoading} size="large" />
            </div>
          ) : 
        <div className="relative md:pl-10">
          <div onClick={()=>scroll(-300)}  className={`${!prevVisible ? 'hidden' : 'md:flex hidden'} cursor-pointer absolute  justify-center items-center top-48 left-24 h-16 w-16 text-2xl bg-[#6A6A6A] rounded-full text-white`}>{"<"}</div>
          <div ref={containerRef} className="overflow-x-auto gap-6 px-1 py-2 flex trending_cards">
            {topSellingProducts
              .filter(product => product.saleQuantity > 0)
              .map((topSellingProduct) => {
                return (
                  <NewTrendingCard
                  topSellingProduct={topSellingProduct}
                  addItemToCart={addItemToCart}
                  parent={"Marketplace"}
                  />)
                })}
          </div>
          <div onClick={()=>scroll(300)}  className={`${!nextVisible ? 'hidden' : 'md:flex hidden'} cursor-pointer absolute justify-center items-center top-48 right-24 h-16 w-16 text-2xl bg-[#6A6A6A] rounded-full text-white`}>{">"}</div>
        </div>}
    </div>
  );
};

export default TopSellingProductCard;