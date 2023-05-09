import React from "react";
import AuthenticatedRoutes from "./AuthenticatedRoutes";
import "@shopify/polaris/build/esm/styles.css";
import { BrowserRouter } from "react-router-dom";
import "./styles/app.css";
import { Layout } from "antd";
import HeaderComponent from "./components/Header/Header";

import { UsersProvider } from "./contexts/users";

const { Content } = Layout;

const App = () => {
    const user = {commonName: "fred"}
    const users = [];

  return (
    <BrowserRouter>
      <Layout>
        <UsersProvider>
          <HeaderComponent user={user} users={users} />
        </UsersProvider>
        <Content>
          <AuthenticatedRoutes />
        </Content>
      </Layout>
    </BrowserRouter>
  );
};

export default App;
