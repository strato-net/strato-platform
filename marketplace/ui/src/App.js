import React, { useEffect, useState } from "react";
import { useAuthenticateState } from "./contexts/authentication";
import AuthenticatedRoutes from "./AuthenticatedRoutes";
import "@shopify/polaris/build/esm/styles.css";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import "./styles/app.css";
import { Layout } from "antd";
import HeaderComponent from "./components/Header/Header";
import TagManager from "react-gtm-module";
import { UsersProvider } from "./contexts/users";
import { getCookie, delete_cookie } from "./helpers/cookie";
import { CategorysProvider } from "./contexts/category";

const { Content } = Layout;

const App = () => {
  const [showMenu, setShowMenu] = useState(false)
  const tagManagerArgs = {
    gtmId: "GTM-NHBZ2BX",
  };

  TagManager.initialize(tagManagerArgs);

  const { user, loginUrl, users, isAuthenticated } = useAuthenticateState();

  window.LOQ = window.LOQ || [];
  window.LOQ.push([
    "ready",
    async (LO) => {
      await LO.$internal.ready("visitor");
      if (user) {
        LO.visitor.identify({
          email: user.email,
          name: user.commonName,
          username: user.preferred_username
        });
      }
    },
  ]);

  // Using this to delete our returnUrl cookie after login
  if (getCookie('returnUrl') && isAuthenticated) {
    window.location.href = getCookie('returnUrl');
    delete_cookie("returnUrl");
  }

  // useEffect if path is empty then redirect to home without using navigate
  // This is needed for non dockerized version to redirect to marketplace after login and anon access
  // not required now as we are using this route "/" fro home page
  // useEffect(() => {
  //   if (window.location.pathname === "/") {
  //     window.location.href = "/";
  //   }
  // }, []);

  useEffect(() => {
    const referrer = document.referrer;
    const specificReferralURL = "https://mercatacarbon.com/";

    if (referrer === specificReferralURL) {
      TagManager.dataLayer({
        dataLayer: {
          event: "redirected_from_mercata_carbon",
        },
      });
    }
  }, []);

  const handleSubMenu = () => {
    setShowMenu(!showMenu)
  }

  const handleMenuTab = (data) => {
    setShowMenu(false)
  }

  return (
    <BrowserRouter basename="/">
      <Layout className="overflow-auto">
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
        <Content className={`${showMenu ? 'overflow-y-hidden md:overflow-auto h-[100vh] md:h-auto w-[100vw] md:w-auto bg-[#00000020] md:bg-white relative mt-0 md:mt-28' : 'mt-[89px] md:mt-[98px] '}`}>
          <AuthenticatedRoutes user={user} users={users} isAuthenticated={isAuthenticated} />
        </Content>
      </Layout>
    </BrowserRouter>
  );
};
export default App;
