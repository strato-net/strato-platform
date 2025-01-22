import { Route, Routes, Navigate } from 'react-router-dom';
import routes from './helpers/routes';
import CategoryProductList from './components/MarketPlace/CategoryProductList';
import { CategorysProvider } from './contexts/category';
import { SubCategorysProvider } from './contexts/subCategory';
import MarketPlace from './components/MarketPlace';
import Product from './components/Product';
import { ProductsProvider } from './contexts/product';
import Inventory from './components/Inventory';
import { InventoriesProvider } from './contexts/inventory';
import { PaymentServicesProvider } from './contexts/payment';
import Item from './components/Item';
import { ItemsProvider } from './contexts/item';
import Stake from './components/Stake';
import SoldOrderDetails from './components/Order/SoldOrderDetails';
import BoughtOrderDetails from './components/Order/BoughtOrderDetails';
import RedemptionsOutgoingDetails from './components/Order/RedemptionsOutgoingDetails';
import RedemptionsIncomingDetails from './components/Order/RedemptionsIncomingDetails';
import { OrdersProvider } from './contexts/order';
import { UsersProvider } from './contexts/users';
import { UserActivityProvider } from './contexts/userActivity';
import AuthorizeIssuer from './components/AuthorizeIssuer';
import { IssuerStatusProvider } from './contexts/issuerStatus';
import ProductDetails from './components/MarketPlace/ProductDetails';
import EthstProductDetails from './components/ETHST/EthstProductDetails';
import Checkout from './components/MarketPlace/Checkout';
import ConfirmOrder from './components/MarketPlace/ConfirmOrder';
import ProcessingOrder from './components/MarketPlace/ProcessingOrder';
import Invoice from './components/Order/Invoice';
import { RedemptionsProvider } from './contexts/redemption';
import LoginRedirect from './components/LoginRedirect';
import UserProfile from './components/UserProfile';
import Error from './components/404';
import FAQ from './components/FAQ/index';
import { TransactionsProvider } from './contexts/transaction';
import { MarketplaceProvider } from './contexts/marketplace';
import { EthProvider } from './contexts/eth';
import Transaction from './components/Order/Transaction';
import Feed from './components/Feed/Feed';

const AuthenticatedRoutes = ({ user, users, isAuthenticated }) => {
  return (
    <Routes>
      <Route
        exact
        path={routes.Marketplace.url}
        element={
          <UsersProvider>
            <CategorysProvider>
              <OrdersProvider>
                <InventoriesProvider>
                  <EthProvider>
                    <MarketPlace
                      user={user}
                      users={users}
                      isAuthenticated={isAuthenticated}
                    />
                  </EthProvider>
                </InventoriesProvider>
              </OrdersProvider>
            </CategorysProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.LoginRedirect.url}
        element={<LoginRedirect />}
      />
      <Route
        exact
        path={routes.Checkout.url}
        element={
          <UsersProvider>
            <CategorysProvider>
              <OrdersProvider>
                <InventoriesProvider>
                  <PaymentServicesProvider>
                    <Checkout />
                  </PaymentServicesProvider>
                </InventoriesProvider>
              </OrdersProvider>
            </CategorysProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.ConfirmOrder.url}
        element={
          <UsersProvider>
            <CategorysProvider>
              <OrdersProvider>
                <InventoriesProvider>
                  <PaymentServicesProvider>
                    <ConfirmOrder user={user} users={users} />
                  </PaymentServicesProvider>
                </InventoriesProvider>
              </OrdersProvider>
            </CategorysProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.ProcessingOrder.url}
        element={
          <UsersProvider>
            <CategorysProvider>
              <OrdersProvider>
                <ProcessingOrder user={user} users={users} />
              </OrdersProvider>
            </CategorysProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.Invoice.url}
        element={
          <UsersProvider>
            <OrdersProvider>
              <MarketplaceProvider>
                <Invoice user={user} users={users} />
              </MarketplaceProvider>
            </OrdersProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.MarketplaceCategoryProductList.url}
        element={
          <UsersProvider>
            <CategorysProvider>
              <SubCategorysProvider>
                <ProductsProvider>
                  <OrdersProvider>
                    <InventoriesProvider>
                      <EthProvider>
                        <CategoryProductList user={user} users={users} />
                      </EthProvider>
                    </InventoriesProvider>
                  </OrdersProvider>
                </ProductsProvider>
              </SubCategorysProvider>
            </CategorysProvider>
          </UsersProvider>
        }
      />
      {user?.isAdmin && (
        <Route
          exact
          path={routes.Admin.url}
          element={
            <UsersProvider>
              <IssuerStatusProvider>
                <InventoriesProvider>
                  <AuthorizeIssuer />
                </InventoriesProvider>
              </IssuerStatusProvider>
            </UsersProvider>
          }
        />
      )}
      <Route
        exact
        path={routes.MarketplaceProductDetail.url}
        element={
          <UsersProvider>
            <CategorysProvider>
              <SubCategorysProvider>
                <PaymentServicesProvider>
                  <InventoriesProvider>
                    <ItemsProvider>
                      <OrdersProvider>
                        <ProductDetails user={user} users={users} />
                      </OrdersProvider>
                    </ItemsProvider>
                  </InventoriesProvider>
                </PaymentServicesProvider>
              </SubCategorysProvider>
            </CategorysProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.EthstProductDetail.url}
        element={
          <UsersProvider>
            <CategorysProvider>
              <SubCategorysProvider>
                <PaymentServicesProvider>
                  <InventoriesProvider>
                    <ItemsProvider>
                      <OrdersProvider>
                        <EthProvider>
                          <EthstProductDetails user={user} users={users} />
                        </EthProvider>
                      </OrdersProvider>
                    </ItemsProvider>
                  </InventoriesProvider>
                </PaymentServicesProvider>
              </SubCategorysProvider>
            </CategorysProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.Products.url}
        element={
          <UsersProvider>
            <CategorysProvider>
              <SubCategorysProvider>
                <ProductsProvider>
                  <Product user={user} users={users} />
                </ProductsProvider>
              </SubCategorysProvider>
            </CategorysProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.MyWallet.url}
        element={
          <UsersProvider>
            <CategorysProvider>
              <SubCategorysProvider>
                <ItemsProvider>
                  <ProductsProvider>
                    <InventoriesProvider>
                      <RedemptionsProvider>
                        <PaymentServicesProvider>
                          <IssuerStatusProvider>
                            <EthProvider>
                              <Inventory user={user} users={users} />
                            </EthProvider>
                          </IssuerStatusProvider>
                        </PaymentServicesProvider>
                      </RedemptionsProvider>
                    </InventoriesProvider>
                  </ProductsProvider>
                </ItemsProvider>
              </SubCategorysProvider>
            </CategorysProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.Stake.url}
        element={
          <UsersProvider>
            <CategorysProvider>
              <SubCategorysProvider>
                <ItemsProvider>
                  <ProductsProvider>
                    <InventoriesProvider>
                      <RedemptionsProvider>
                        <PaymentServicesProvider>
                          <IssuerStatusProvider>
                            <EthProvider>
                              <Stake user={user} />
                            </EthProvider>
                          </IssuerStatusProvider>
                        </PaymentServicesProvider>
                      </RedemptionsProvider>
                    </InventoriesProvider>
                  </ProductsProvider>
                </ItemsProvider>
              </SubCategorysProvider>
            </CategorysProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.InventoryDetail.url}
        element={
          <UsersProvider>
            <CategorysProvider>
              <SubCategorysProvider>
                <PaymentServicesProvider>
                  <InventoriesProvider>
                    <ItemsProvider>
                      <OrdersProvider>
                        <ProductDetails user={user} users={users} />
                      </OrdersProvider>
                    </ItemsProvider>
                  </InventoriesProvider>
                </PaymentServicesProvider>
              </SubCategorysProvider>
            </CategorysProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.MarketplaceUserProfile.url}
        element={
          <UsersProvider>
            <CategorysProvider>
              <SubCategorysProvider>
                <InventoriesProvider>
                  <ItemsProvider>
                    <OrdersProvider>
                      <PaymentServicesProvider>
                        <RedemptionsProvider>
                          <IssuerStatusProvider>
                            <UserActivityProvider>
                              <EthProvider>
                                <UserProfile user={user} users={users} />
                              </EthProvider>
                            </UserActivityProvider>
                          </IssuerStatusProvider>
                        </RedemptionsProvider>
                      </PaymentServicesProvider>
                    </OrdersProvider>
                  </ItemsProvider>
                </InventoriesProvider>
              </SubCategorysProvider>
            </CategorysProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.Items.url}
        element={
          <UsersProvider>
            <ItemsProvider>
              <Item user={user} users={users} />
            </ItemsProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.Transactions.url}
        element={
          <UsersProvider>
            <CategorysProvider>
              <TransactionsProvider>
                <OrdersProvider>
                  <ItemsProvider>
                    <InventoriesProvider>
                      <RedemptionsProvider>
                        <EthProvider>
                          <Transaction user={user} users={users} />
                        </EthProvider>
                      </RedemptionsProvider>
                    </InventoriesProvider>
                  </ItemsProvider>
                </OrdersProvider>
              </TransactionsProvider>
            </CategorysProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.ActivityFeed.url}
        element={
          <UsersProvider>
            <CategorysProvider>
              <TransactionsProvider>
                <OrdersProvider>
                  <ItemsProvider>
                    <InventoriesProvider>
                      <RedemptionsProvider>
                        <EthProvider>
                          <Feed user={user} users={users} />
                        </EthProvider>
                      </RedemptionsProvider>
                    </InventoriesProvider>
                  </ItemsProvider>
                </OrdersProvider>
              </TransactionsProvider>
            </CategorysProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.SoldOrderDetails.url}
        element={
          <UsersProvider>
            <OrdersProvider>
              <SoldOrderDetails user={user} users={users} />
            </OrdersProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.BoughtOrderDetails.url}
        element={
          <UsersProvider>
            <OrdersProvider>
              <BoughtOrderDetails user={user} users={users} />
            </OrdersProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.RedemptionsOutgoingDetails.url}
        element={
          <UsersProvider>
            <OrdersProvider>
              <RedemptionsProvider>
                <InventoriesProvider>
                  <RedemptionsOutgoingDetails user={user} />
                </InventoriesProvider>
              </RedemptionsProvider>
            </OrdersProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.RedemptionsIncomingDetails.url}
        element={
          <UsersProvider>
            <OrdersProvider>
              <RedemptionsProvider>
                <InventoriesProvider>
                  <RedemptionsIncomingDetails user={user} />
                </InventoriesProvider>
              </RedemptionsProvider>
            </OrdersProvider>
          </UsersProvider>
        }
      />
      <Route exact path={routes.FAQ.url} element={<FAQ />} />
      <Route path="*" element={<Error />} />
    </Routes>
  );
};

export default AuthenticatedRoutes;
