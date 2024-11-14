import React, { useEffect, useRef, useState } from 'react';
import { Typography, Spin, notification, Button } from 'antd';
import { actions } from '../../contexts/marketplace/actions';
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from '../../contexts/marketplace';
import { useNavigate } from 'react-router-dom';
import routes from '../../helpers/routes';
import { useAuthenticateState } from '../../contexts/authentication';
import NewTrendingCard from './NewTrendingCard';
import { actions as orderActions } from '../../contexts/order/actions';
import { useOrderDispatch } from '../../contexts/order';
import { Fade } from 'react-awesome-reveal';

const { Title } = Typography;

const TopSellingProductCard = () => {
  const containerRef = useRef(null);
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const marketplaceDispatch = useMarketplaceDispatch();
  const { topSellingProducts, isTopSellingProductsLoading, cartList } =
    useMarketplaceState();
  let { hasChecked, isAuthenticated, loginUrl, user } = useAuthenticateState();
  const [api, contextHolder] = notification.useNotification();

  const orderDispatch = useOrderDispatch();

  useEffect(() => {
    if (hasChecked && !isAuthenticated) {
      actions.fetchTopSellingProducts(marketplaceDispatch, offset, limit);
    } else if (hasChecked && isAuthenticated) {
      actions.fetchTopSellingProductsLoggedIn(
        marketplaceDispatch,
        offset,
        limit
      );
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

  // const addItemToCart = async (product, quantity) => {
  //   if (product.ownerCommonName === user?.commonName) {
  //     openToast("bottom", true, "Cannot buy your own item");
  //     return false;
  //   }

  //   // Search for the product in the cart
  //   let foundIndex = cartList.findIndex(
  //     (item) => item.product.address === product.address
  //   );
  //   let items = [...cartList];

  //   // Found index returns -1 if nothing is found in the cartlist
  //   if (foundIndex === -1) {
  //     // Product not found, check quantity before adding
  //     const checkQuantity = await orderActions.fetchSaleQuantity(
  //       orderDispatch,
  //       [product.saleAddress],
  //       [quantity]
  //     );
  //     if (checkQuantity === true) {
  //       // Quantity check passed, add new item to the cart
  //       items = [{ product, qty: quantity }]
  //       actions.addItemToCart(marketplaceDispatch, items);
  //       openToast("bottom", false, "Item added to cart");
  //       return true;
  //     } else {
  //       // Not enough quantity, inform the user
  //       if (checkQuantity[0].availableQuantity === 0) {
  //         openToast(
  //           "bottom",
  //           true,
  //           `Unfortunately, ${product.name} is currently out of stock. We recommend checking back soon or browsing similar items available now.`
  //         );
  //       } else {
  //         // Case 2: We are trying to add too much quantity
  //         openToast(
  //           "bottom",
  //           true,
  //           `Unfortunately, only ${checkQuantity[0].availableQuantity} units of ${product.name} are available. Please update your cart quantity accordingly.`
  //         );
  //         setTimeout(() => {
  //           navigate('/checkout')
  //         }, 2000);
  //       }
  //       return false;
  //     }
  //   } else {
  //     // Product found, prepare to update quantity after check
  //     const potentialNewQty = items[foundIndex].qty + quantity;
  //     const checkQuantity = await orderActions.fetchSaleQuantity(
  //       orderDispatch,
  //       [product.saleAddress],
  //       [potentialNewQty]
  //     );
  //     if (checkQuantity === true) {
  //       // Quantity check passed, update item quantity in the cart
  //       items[foundIndex].qty = potentialNewQty;
  //       actions.addItemToCart(marketplaceDispatch, items);
  //       openToast("bottom", false, "Item updated in cart");
  //       return true;
  //     } else {
  //       // Not enough quantity, inform the user
  //       if (checkQuantity[0].availableQuantity === 0) {
  //         openToast(
  //           "bottom",
  //           true,
  //           `Unfortunately, ${product.name} is currently out of stock. We recommend checking back soon or browsing similar items available now.`
  //         );
  //       } else {
  //         // Case 2: We are trying to add too much quantity
  //         openToast(
  //           "bottom",
  //           true,
  //           `Unfortunately, only ${checkQuantity[0].availableQuantity} units of ${product.name} are available. Please update your cart quantity accordingly.`
  //         );
  //         setTimeout(() => {
  //           navigate('/checkout')
  //         }, 2000);
  //       }
  //       return false;
  //     }
  //   }
  // };

  const addItemToCart = async (product, quantity) => {
    const items = [{ product, qty: quantity }];
    actions.addItemToCart(marketplaceDispatch, items);
    navigate('/checkout');
    window.scrollTo(0, 0);
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
    parent?.addEventListener('scroll', handleScroll);
    return () => {
      parent?.removeEventListener('scroll', handleScroll);
    };
  }, [topSellingProducts]);

  const scroll = (left) => {
    containerRef.current.scrollBy({
      top: 0,
      left,
      behavior: 'smooth',
    });
  };

  const navRoute = routes.MarketplaceCategoryProductList.url.replace(
    ':category',
    'All'
  );

  return (
    <div>
      {contextHolder}
      <Fade triggerOnce>
        <div className="pt-5 pr-2 md:pr-10 flex justify-between">
          <Title className="md:px-10 !text-xl md:!text-4xl !text-left">
            Trending Items
          </Title>
          <Button
            size="large"
            id="viewAll"
            onClick={() => {
              navigate(navRoute);
              sessionStorage.setItem('scrollPosition', 0);
            }}
            className="text-black hover:!text-black border-grayDark hidden md:flex"
          >
            View All
          </Button>
          <Button
            size="small"
            onClick={() => {
              navigate(navRoute);
              sessionStorage.setItem('scrollPosition', 0);
            }}
            className="text-black hover:!text-black border-grayDark flex md:hidden"
          >
            View All
          </Button>
        </div>
      </Fade>
      {isTopSellingProductsLoading ? (
        <div className="h-52 flex justify-center items-center">
          <Spin spinning={isTopSellingProductsLoading} size="large" />
        </div>
      ) : (
        <Fade direction="right" triggerOnce>
          <div className="relative md:pl-10">
            <div
              ref={containerRef}
              className="overflow-x-auto gap-6 px-1 py-2 flex trending_cards"
            >
              {topSellingProducts
                .filter((product) => product.saleQuantity > 0)
                .map((topSellingProduct) => {
                  return (
                    <NewTrendingCard
                      topSellingProduct={topSellingProduct}
                      addItemToCart={addItemToCart}
                      parent={'Marketplace'}
                    />
                  );
                })}
            </div>
            <Button
              type="primary"
              onClick={() => scroll(-300)}
              className={`${
                !prevVisible ? 'hidden' : 'md:flex hidden'
              } cursor-pointer absolute z-10 justify-center items-center top-48 left-24 h-12 w-12 text-2xl bg-[#6A6A6A] rounded-full text-white`}
            >
              {'<'}
            </Button>
            <Button
              type="primary"
              onClick={() => scroll(300)}
              className={`${
                !nextVisible ? 'hidden' : 'md:flex hidden'
              } cursor-pointer absolute justify-center items-center top-48 right-24 h-12 w-12 text-2xl bg-[#6A6A6A] rounded-full text-white z-20`}
            >
              {'>'}
            </Button>
          </div>
        </Fade>
      )}
      <h3 className="text-center text-gray-500 mt-8">
        Is there an item you would like to see on the marketplace?
        <a
          href="https://forms.gle/biuEtUHrFdLpX1d36"
          rel="noreferrer"
          target="_blank"
          className="text-blue"
        >
          {' '}
          Let us know!
        </a>
      </h3>
    </div>
  );
};

export default TopSellingProductCard;
