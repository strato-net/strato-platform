import { Breadcrumb, notification } from 'antd';
import React, { useEffect, useState } from 'react';
import routes from '../../helpers/routes';
import ClickableCell from '../ClickableCell';
import { actions as marketplaceActions } from '../../contexts/marketplace/actions';
import { actions as ethActions } from '../../contexts/eth/actions';
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from '../../contexts/marketplace';
import { useEthDispatch, useEthState } from '../../contexts/eth';
import GlobalTransaction from './GlobalTransaction';

const Feed = ({ user }) => {
  const [api, contextHolder] = notification.useNotification();
  const { USDSTAddress, assetsWithEighteenDecimalPlaces } =
    useMarketplaceState();
  const { ethstAddress } = useEthState();

  const marketplaceDispatch = useMarketplaceDispatch();
  const ethDispatch = useEthDispatch();

  useEffect(() => {
    const fetchAddresses = async () => {
      await marketplaceActions.fetchUSDSTAddress(marketplaceDispatch);
      await marketplaceActions.fetchAssetsWithEighteenDecimalPlaces(
        marketplaceDispatch
      );
      await ethActions.fetchETHSTAddress(ethDispatch);
    };

    fetchAddresses();
  }, []);

  return (
    <div>
      {contextHolder}
      <Breadcrumb className="mx-5 md:mx-14 mt-2 lg:mt-4">
        <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
          <ClickableCell href={routes.Marketplace.url}>
            <p className="text-sm text-[#13188A] font-semibold">Home</p>
          </ClickableCell>
        </Breadcrumb.Item>
        <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
          <p className=" text-sm text-[#202020] font-medium">Activity Feed</p>
        </Breadcrumb.Item>
      </Breadcrumb>
      {USDSTAddress && assetsWithEighteenDecimalPlaces?.length > 0 && (
        <GlobalTransaction
          user={user}
          USDSTAddress={USDSTAddress}
          assetsWithEighteenDecimalPlaces={assetsWithEighteenDecimalPlaces}
          ethstAddress={ethstAddress}
        />
      )}
    </div>
  );
};

export default Feed;
