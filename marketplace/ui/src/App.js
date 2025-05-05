import React, { useEffect, useState } from 'react';
import { useAuthenticateState } from './contexts/authentication';
import AuthenticatedRoutes from './AuthenticatedRoutes';
import '@shopify/polaris/build/esm/styles.css';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './styles/app.css';
import { Layout } from 'antd';
import HeaderComponent from './components/Header/Header';
import FooterComponent from './components/Footer/FooterComponent';
import TagManager from 'react-gtm-module';
import { UsersProvider } from './contexts/users';
import { useMarketplaceState } from './contexts/marketplace';
import { setCookie, getCookie, delete_cookie } from './helpers/cookie';
import InternalError from './components/500';
import { CategorysProvider } from './contexts/category';
import { useEventStream } from './helpers/websocket';
import { actions as inventoryActions } from './contexts/inventory/actions';
import { useInventoryDispatch } from './contexts/inventory';
import { BigNumber } from 'bignumber.js';

const { Content } = Layout;

const App = () => {
  const [showMenu, setShowMenu] = useState(false);
  const inventoryDispatch = useInventoryDispatch();
  const { isMarketplaceLoading } = useMarketplaceState();
  const tagManagerArgs = {
    gtmId: 'GTM-NHBZ2BX',
  };

  TagManager.initialize(tagManagerArgs);

  const { user, loginUrl, users, isAuthenticated, error } =
    useAuthenticateState();

  window.LOQ = window.LOQ || [];
  window.LOQ.push([
    'ready',
    async (LO) => {
      await LO.$internal.ready('visitor');
      if (user) {
        LO.visitor.identify({
          email: user.email,
          name: user.commonName,
          username: user.preferred_username,
        });
      }
    },
  ]);

  // Using this to delete our returnUrl cookie after login
  if (getCookie('returnUrl') && isAuthenticated) {
    window.location.href = getCookie('returnUrl');
    delete_cookie('returnUrl');
  }

  useEffect(() => {
    // Set the cookie expiration time to 7 days (10080 minutes)
    const SLIDING_EXPIRATION_MINUTES = 10080; // 7 days

    const urlParams = new URLSearchParams(window.location.search);
    const refValue = urlParams.get('ref');
    
    if (refValue) {
      const existingRef = getCookie('mercata_referrer_address');
    
      if (existingRef === refValue) {
        setCookie('mercata_referrer_address', refValue, SLIDING_EXPIRATION_MINUTES);
      } else if (!existingRef) {
        setCookie('mercata_referrer_address', refValue, SLIDING_EXPIRATION_MINUTES);
      }
    }
  }, []);

  useEffect(() => {
    const referrer = document.referrer;
    const specificReferralURL = 'https://mercatacarbon.com/';

    if (referrer === specificReferralURL) {
      TagManager.dataLayer({
        dataLayer: {
          event: 'redirected_from_mercata_carbon',
        },
      });
    }
  }, []);

  const handleSubMenu = () => {
    setShowMenu(!showMenu);
  };

  const handleMenuTab = (data) => {
    setShowMenu(false);
  };

  const { lastMessage } = useEventStream();

  useEffect(() => {
    if (lastMessage) {
      try {
        const eventData = JSON.parse(lastMessage.data);
        const eventName = eventData?.eventEvent?.eventName;

        const eventArgs = eventData?.eventEvent?.eventArgs.reduce(
          (acc, [key, value]) => {
            acc[key] = value;
            return acc;
          },
          {}
        );

        const eventContractAddress = eventData?.eventEvent?.eventContractAddress;

        if (eventName === 'MintedETHST') {
          const { amount: stakeQuantity, username: ownerCommonName } =
            eventArgs;

          const body = {
            stakeQuantity: new BigNumber(stakeQuantity).toFixed(0),
            assetAddress: eventContractAddress,
            ownerCommonName,
          };

          inventoryActions.stakeAfterBridge(inventoryDispatch, body);
        }
      } catch (error) {
        console.error('Error parsing WebSocket event:', lastMessage.data);
      }
    }
  }, [lastMessage]);

  return (
    <BrowserRouter basename="/">
      <Layout>
        <UsersProvider>
          <CategorysProvider>
            <HeaderComponent
              isOauth={isAuthenticated}
              user={user}
              users={users}
              loginUrl={loginUrl}
              showMenu={showMenu}
              handleSubMenu={handleSubMenu}
              handleMenuTab={handleMenuTab}
            />
          </CategorysProvider>
        </UsersProvider>
        {error === 'Internal Server Error 101' ? (
          <InternalError />
        ) : (
          <Content
            className={`${
              showMenu
                ? 'overflow-y-hidden md:overflow-auto h-[100vh] md:h-auto w-[100vw] md:w-auto bg-[#00000020] md:bg-white relative mt-0 md:mt-28'
                : 'mt-[89px] md:mt-[84px] '
            }`}
          >
            <AuthenticatedRoutes
              user={user}
              users={users}
              isAuthenticated={isAuthenticated}
            />
          </Content>
        )}
        {!isMarketplaceLoading && <FooterComponent />}
      </Layout>
    </BrowserRouter>
  );
};
export default App;
