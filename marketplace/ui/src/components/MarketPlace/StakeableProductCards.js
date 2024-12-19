import React, { useEffect, useRef, useState } from 'react';
import { Typography, Spin, notification, Button } from 'antd';
import { actions } from '../../contexts/marketplace/actions';
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from '../../contexts/marketplace';
import { useInventoryState } from '../../contexts/inventory';
import { useNavigate } from 'react-router-dom';
import NewTrendingCard from './NewTrendingCard';
import { Fade } from 'react-awesome-reveal';

const { Title } = Typography;

const StakeableProductCards = () => {
  const containerRef = useRef(null);
  const marketplaceDispatch = useMarketplaceDispatch();
  const { stakeableProducts, isStakeableProductsLoading } =
    useMarketplaceState();
  const { reserves } = useInventoryState();
  const [api, contextHolder] = notification.useNotification();

  useEffect(() => {
    if (reserves) {
      actions.fetchStakeableProducts(
        marketplaceDispatch,
        reserves
          .filter((reserve) => !reserve.name.toLowerCase().includes('temp'))
          .map((reserve) => reserve.assetRootAddress)
      );
    }
  }, [marketplaceDispatch, reserves]);

  const navigate = useNavigate();

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
  }, [stakeableProducts]);

  const scroll = (left) => {
    containerRef.current.scrollBy({
      top: 0,
      left,
      behavior: 'smooth',
    });
  };

  return (
    <div>
      {contextHolder}
      <Fade triggerOnce>
        <div className="pt-5 pr-2 md:pr-10 flex justify-between">
          <Title className="md:px-10 !text-xl md:!text-4xl !text-left">
            Stakeable Items
          </Title>
        </div>
      </Fade>
      {isStakeableProductsLoading ? (
        <div className="h-52 flex justify-center items-center">
          <Spin spinning={isStakeableProductsLoading} size="large" />
        </div>
      ) : (
        <Fade direction="right" triggerOnce>
          <div className="relative md:pl-10">
            <div
              ref={containerRef}
              className="overflow-x-auto gap-6 px-1 py-2 flex trending_cards"
            >
              {stakeableProducts.map((topSellingProduct) => {
                const matchingReserve = reserves?.find(
                  (reserve) =>
                    reserve.assetRootAddress === topSellingProduct.address
                );
                return (
                  <NewTrendingCard
                    topSellingProduct={topSellingProduct}
                    addItemToCart={addItemToCart}
                    parent={'Marketplace'}
                    reserve={matchingReserve}
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
    </div>
  );
};

export default StakeableProductCards;
