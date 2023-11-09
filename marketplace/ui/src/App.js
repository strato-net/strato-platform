import React, { useEffect, useState } from "react";
import { useAuthenticateState, useAuthenticateDispatch } from "./contexts/authentication";
import AuthenticatedRoutes from "./AuthenticatedRoutes";
import { actions } from "./contexts/authentication/actions";
import "@shopify/polaris/build/esm/styles.css";
import { BrowserRouter } from "react-router-dom";
import "./styles/app.css";
import { Layout } from "antd";
import HeaderComponent from "./components/Header/Header";
import TagManager from "react-gtm-module";
import { UsersProvider } from "./contexts/users";
import { getCookie, delete_cookie } from "./helpers/cookie";
import { useIdleTimeout } from "./helpers/useIdleTimeout";
import IdleModal from "./components/Header/IdleModal";

const { Content } = Layout;

const App = () => {

  const tagManagerArgs = {
    gtmId: 'GTM-NHBZ2BX'
  };

  TagManager.initialize(tagManagerArgs);

  const { user, loginUrl, users, isAuthenticated } = useAuthenticateState();
  const userDispatch = useAuthenticateDispatch();
  const [isIdleModalOpen, setIsIdleModalOpen] = useState(false);
  const handleIdle = () => {
    setIsIdleModalOpen(true);
  }
  const { idleTimer } = useIdleTimeout({ onIdle: handleIdle, idleTime: 105 })  // number is in minutes
  const stay = () => {
    setIsIdleModalOpen(false);
    idleTimer.reset();
  }
  const logout = () => {
    TagManager.dataLayer({
      dataLayer: {
        event: 'logout',
      },
    });
    actions.logout(userDispatch);
    setIsIdleModalOpen(false);
  };

  // Using this to delete our returnUrl cookie after login
  if (getCookie('returnUrl') && isAuthenticated) {
    window.location.href = getCookie('returnUrl');
    delete_cookie('returnUrl');
  }

  // useEffect if path is empty then redirect to marketplace without using navigate
  // This is needed for non dockerized version to redirect to marketplace after login and anon access
  useEffect(() => {
    if (window.location.pathname === "/") {
      window.location.href = "/marketplace";
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
  }, [])


  return (
    <BrowserRouter basename="/marketplace">
      <Layout>
        <UsersProvider>
          <HeaderComponent isOauth={isAuthenticated} user={user} users={users} loginUrl={loginUrl} />
        </UsersProvider>
        <Content>
          <AuthenticatedRoutes user={user} users={users} />
        </Content>
        {user && <IdleModal
          isOpen={isIdleModalOpen}
          stay={stay}
          logout={logout}
        />}
      </Layout>
    </BrowserRouter>
  );
};
export default App;
