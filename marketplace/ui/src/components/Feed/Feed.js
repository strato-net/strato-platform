import { Breadcrumb, notification } from 'antd';
import React, { useEffect, useState } from 'react';
import routes from '../../helpers/routes';
import ClickableCell from '../ClickableCell';
import { actions as marketplaceActions } from '../../contexts/marketplace/actions';
import { useMarketplaceDispatch } from '../../contexts/marketplace';
import GlobalTransaction from './GlobalTransaction';

const Feed = ({ user }) => {
  const [api, contextHolder] = notification.useNotification();

  const marketplaceDispatch = useMarketplaceDispatch();
  const [stratAddress, setStratAddress] = useState('');
  const [cataAddress, setCataAddress] = useState('');

  useEffect(() => {
    const fetchAddresses = async () => {
      const stratAddress = await marketplaceActions.fetchStratsAddress(
        marketplaceDispatch
      );
      const cataAddress = await marketplaceActions.fetchCataAddress(
        marketplaceDispatch
      );
      setStratAddress(stratAddress);
      setCataAddress(cataAddress);
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
      <GlobalTransaction
        user={user}
        stratAddress={stratAddress}
        cataAddress={cataAddress}
      />
    </div>
  );
};

export default Feed;
