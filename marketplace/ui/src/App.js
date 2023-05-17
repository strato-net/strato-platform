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
  // const theme = {
  //   colors: {
  //     topBar: {
  //       background: "#fff",
  //     },
  //   },
  // };

  const dispatch = useAuthenticateDispatch();

 const { isAuthenticated, hasChecked, user, loginUrl, users } =
   useAuthenticateState();

    // const isAuthenticated = true;            // These are dummy hardcoded values, they need to be set properly
    // const hasChecked = true;
    // const user = {commonName: "fred"}
    // const loginUrl = "abcd"
    // const users = [];


  useEffect(() => {
    if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
      window.location.href = loginUrl;
    }
  }, [isAuthenticated, hasChecked, loginUrl]);

  // useEffect(() => {
  //   if (isAuthenticated) {
  //     actions.fetchUsers(dispatch);
  //   }
  // }, [isAuthenticated]);

  return (
    <BrowserRouter>
      <Layout>
        <UsersProvider>
          <HeaderComponent user={user} users={users} />
        </UsersProvider>

        {hasChecked && isAuthenticated ? (
          <Content>
            <AuthenticatedRoutes user={user} users={users} />
          </Content>
        ) : (
          <div className="w-96 m-auto h-screen mt-5">
            {hasChecked && !isAuthenticated && loginUrl === undefined ? (
              <Card size="small" title="Authentication Error">
                <p>
                  An error occured when attempting to verify user credentials.
                  Perhaps the user does not exist in asset Framework yet.
                  Contact a System Administrator
                </p>
              </Card>
            ) : (
              <Card title="Checking Authentication">
                <div className="text-center">
                  <Spin />
                </div>
              </Card>
            )}
          </div>
        )}
      </Layout>
      {/* <AppProvider theme={theme}>
        <Frame
          topBar={AssetFrameworkTopBar({ user, logout: () => actions.logout(dispatch) })}
          navigation={
            isAuthenticated ? AssetFrameworkNavigation({ isAuthenticated, user }) : null
          }
        >
          {hasChecked && isAuthenticated ? (
            <AuthenticatedRoutes user={user} users={users} />
          ) : (
            <Page>
              <Layout>
                <Layout.Section>
                  <div style={{ width: "420px", margin: "auto" }}>
                    {hasChecked && !isAuthenticated && loginUrl === undefined ? (
                      <Card size="small" title="Authentication Error" sectioned>
                        <p>
                          An error occured when attempting to verify user
                          credentials. Perhaps the user does not exist in
                          asset Framework yet. Contact a System Administrator
                        </p>
                      </Card>
                    ) : (
                      <Card title="Checking Authentication" sectioned>
                        <Spinner />
                      </Card>
                    )}
                  </div>
                </Layout.Section>
              </Layout>
            </Page>
          )}
        </Frame>
      </AppProvider> */}
    </BrowserRouter>
  );
};
export default App;
