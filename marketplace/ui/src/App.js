import React, { useEffect } from "react";
import {
  useAuthenticateState,
  useAuthenticateDispatch,
} from "./contexts/authentication";
import AuthenticatedRoutes from "./AuthenticatedRoutes";
import "@shopify/polaris/build/esm/styles.css";
import { actions } from "./contexts/authentication/actions";
import { BrowserRouter } from "react-router-dom";
import "./styles/app.css";
import { Layout, Card, Spin } from "antd";
import HeaderComponent from "./components/Header/Header";

import { UsersProvider } from "./contexts/users";

const { Content } = Layout;

const App = () => {

  const dispatch = useAuthenticateDispatch();

  const { isAuthenticated, hasChecked, user, loginUrl, users } =
    useAuthenticateState();

  return (
    <BrowserRouter>
      <Layout>
        <UsersProvider>
          <HeaderComponent user={user} users={users} loginUrl={loginUrl} />
        </UsersProvider>
        <Content>
          <AuthenticatedRoutes user={user} users={users} />
        </Content>
      </Layout>
    </BrowserRouter>
  );
};
export default App;
