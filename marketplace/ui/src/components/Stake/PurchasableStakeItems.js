import React, { useEffect, useRef, useState } from 'react';
import { Typography, Spin } from 'antd';
import { actions as marketplaceActions } from '../../contexts/marketplace/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from '../../contexts/marketplace';
import NewVaultCard from '../MarketPlace/NewVaultCard';
import { Fade } from 'react-awesome-reveal';

const { Title } = Typography;

const PurchasableStakeItems = () => {
  const containerRef = useRef(null);

  const marketplaceDispatch = useMarketplaceDispatch();
  const { reserves, isReservesLoading } = useInventoryState();
  const { stakeableProducts, isStakeableProductsLoading } =
    useMarketplaceState();

  useEffect(() => {
    if (reserves) {
      marketplaceActions.fetchStakeableProducts(
        marketplaceDispatch,
        reserves
          .filter((reserve) => !reserve.name.toLowerCase().includes('temp'))
          .map((reserve) => reserve.assetRootAddress)
      );
    }
  }, [reserves]);

  return (
    <div>
      <Fade triggerOnce>
        <div className="pt-5 pr-2 md:pr-10 flex justify-between">
          <Title className="px-3 !text-3xl !text-left mt-10">
            Buy Stakeable Items
          </Title>
        </div>
      </Fade>
      {stakeableProducts?.length <= 0 || !reserves ? (
        <div className="h-52 flex justify-center items-center">
          <Spin
            spinning={isStakeableProductsLoading || isReservesLoading}
            size="large"
          />
        </div>
      ) : (
        <Fade direction="right" triggerOnce>
          <div className="relative">
            <div
              ref={containerRef}
              className="overflow-x-auto gap-6 px-1 py-2 flex trending_cards"
            >
              {stakeableProducts.map((stakeableProduct) => {
                const matchingReserve = reserves?.find(
                  (reserve) =>
                    reserve.assetRootAddress === stakeableProduct.root
                );
                return (
                  <NewVaultCard
                    key={stakeableProduct.assetRootAddress}
                    reserveItem={stakeableProduct}
                    reserve={matchingReserve}
                  />
                );
              })}
            </div>
          </div>
        </Fade>
      )}
    </div>
  );
};

export default PurchasableStakeItems;
