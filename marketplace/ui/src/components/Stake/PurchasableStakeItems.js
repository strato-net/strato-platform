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
import { useAuthenticateState } from '../../contexts/authentication';
import NewVaultCard from '../MarketPlace/NewVaultCard';
import { Fade } from 'react-awesome-reveal';

const { Title } = Typography;

const PurchasableStakeItems = () => {
  const containerRef = useRef(null);
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const inventoryDispatch = useInventoryDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();
  const { isReservesLoading, reserves } = useInventoryState();
  const { stakeableProducts, isStakeableProductsLoading } =
    useMarketplaceState();
  let { hasChecked, isAuthenticated, loginUrl, user } = useAuthenticateState();

  useEffect(() => {
    if (hasChecked && isAuthenticated && reserves) {
      marketplaceActions.fetchStakeableProductsLoggedIn(
        marketplaceDispatch,
        offset,
        limit,
        reserves.map((reserve) => reserve.assetRootAddress)
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
      {isStakeableProductsLoading || !stakeableProducts ? (
        <div className="h-52 flex justify-center items-center">
          <Spin spinning={isStakeableProductsLoading} size="large" />
        </div>
      ) : (
        <Fade direction="right" triggerOnce>
          <div className="relative">
            <div
              ref={containerRef}
              className="overflow-x-auto gap-6 px-1 py-2 flex trending_cards"
            >
              {stakeableProducts.map((reserveItem) => {
                return <NewVaultCard reserveItem={reserveItem} />;
              })}
            </div>
          </div>
        </Fade>
      )}
    </div>
  );
};

export default PurchasableStakeItems;
