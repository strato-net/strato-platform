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

import { UsersProvider } from "./contexts/users";

const { Content } = Layout;

const App = () => {

  const {user, loginUrl, users } =
    useAuthenticateState();
    
    
  // useEffect if path is empty then redirect to marketplace without using navigate
  // This is needed for non dockerized version to redirect to marketplace after login and anon access
  useEffect(() => {
    if (window.location.pathname === "/") {
      window.location.href = "/marketplace";
    }
  }, []);
  
  
  return (
    <BrowserRouter basename="/marketplace">
      <Layout>
        <UsersProvider>
          <HeaderComponent user={user} users={users} loginUrl={loginUrl} />
        </UsersProvider>
        <Content className="mt-20">
          <AuthenticatedRoutes user={user} users={users} />
        </Content>
      </Layout>
    </BrowserRouter>
  );
};
export default App;
