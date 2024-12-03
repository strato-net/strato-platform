import { Breadcrumb, notification } from 'antd';
import React, { useEffect, useState } from 'react';
import routes from '../../helpers/routes';
import ClickableCell from '../ClickableCell';
import { actions as marketplaceActions } from '../../contexts/marketplace/actions';
import { useMarketplaceDispatch, useMarketplaceState } from '../../contexts/marketplace';
import GlobalTransaction from './GlobalTransaction';

const Feed = ({ user }) => {
  const [api, contextHolder] = notification.useNotification();
  const { stratsAddress, cataAddress } = useMarketplaceState();

  const marketplaceDispatch = useMarketplaceDispatch();

  useEffect(() => {
    const fetchAddresses = async () => {
      marketplaceActions.fetchStratsAddress(
        marketplaceDispatch
      );
      marketplaceActions.fetchCataAddress(
        marketplaceDispatch
      );
    };

    fetchAddresses();
  }, []);

  return (
    <div>
      {contextHolder}
      <div className="px-4 md:px-10 lg:py-2 lg:mt-3 orders">
        <Breadcrumb>
          <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
            <ClickableCell href={routes.Marketplace.url}>
              <p className="text-sm text-[#13188A] font-semibold">Home</p>
            </ClickableCell>
          </Breadcrumb.Item>
          <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
            <p className=" text-sm text-[#202020] font-medium">Activity Feed</p>
          </Breadcrumb.Item>
        </Breadcrumb>
      </div>
      {stratsAddress && cataAddress && 
      <GlobalTransaction
        user={user}
        stratAddress={stratsAddress}
        cataAddress={cataAddress}
      />}
    </div>
  );
};

export default Feed;
