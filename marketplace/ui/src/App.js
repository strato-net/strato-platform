import React, { useEffect } from "react";
import AuthenticatedRoutes from "./AuthenticatedRoutes";
import { useAuthenticateState, useAuthenticateDispatch } from "./contexts/authentication/index.js";
import { actions } from "./contexts/authentication/actions";
import "@shopify/polaris/build/esm/styles.css";
import { BrowserRouter } from "react-router-dom";
import "./styles/app.css";
import { Layout } from "antd";
import HeaderComponent from "./components/Header/Header";

import { UsersProvider } from "./contexts/users";

const { Content } = Layout;

const App = () => {

  const dispatch = useAuthenticateDispatch()
  const { user, users, loginUrl } = useAuthenticateState()
  console.log('loginUrl', loginUrl)

  useEffect(() => {
    actions.fetchUsers(dispatch)
  }, [dispatch])

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
