import React, { useEffect } from "react";
import {
  useAuthenticateState
} from "./contexts/authentication";
import AuthenticatedRoutes from "./AuthenticatedRoutes";
import "@shopify/polaris/build/esm/styles.css";
import { BrowserRouter } from "react-router-dom";
import "./styles/app.css";
import { Layout } from "antd";
import HeaderComponent from "./components/Header/Header";
import TagManager from "react-gtm-module";
import { UsersProvider } from "./contexts/users";

const { Content } = Layout;

const App = () => {

  const tagManagerArgs = {
    gtmId: 'GTM-NHBZ2BX'
  };

  TagManager.initialize(tagManagerArgs);

  const { user, loginUrl, users, isAuthenticated } =
    useAuthenticateState();


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
    console.log("Refer link", referrer);

    if (referrer === specificReferralURL) {
      console.log("Event fired");
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
      </Layout>
    </BrowserRouter>
  );
};
export default App;
