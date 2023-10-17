import { Route, Routes, Navigate } from "react-router-dom";
import routes from "./helpers/routes";
import CategoryProductList from "./components/MarketPlace/CategoryProductList";
import { CategorysProvider } from "./contexts/category";
import { SubCategorysProvider } from "./contexts/subCategory";
import MarketPlace from "./components/MarketPlace";
import Product from "./components/Product";
import { ProductsProvider } from "./contexts/product";
import Inventory from "./components/Inventory";
import { InventoriesProvider } from "./contexts/inventory";
import Item from "./components/Item";
import { ItemsProvider } from "./contexts/item";
import Order from "./components/Order";
import SoldOrderDetails from "./components/Order/SoldOrderDetails";
import BoughtOrderDetails from "./components/Order/BoughtOrderDetails";
import BoughtOrderItemDetail from "./components/Order/BoughtOrderItemDetail";
import SoldOrderItemDetail from "./components/Order/SoldOrderItemDetail";
import OrderItemEventsList from "./components/Order/OrderItemEventsList";
import { OrdersProvider } from "./contexts/order";
import { EventTypesProvider } from "./contexts/eventType";
import Event from "./components/Event";
import EventDetails from "./components/Event/EventDetails";
import { EventsProvider } from "./contexts/event";
import { UsersProvider } from "./contexts/users";
import EventList from "./components/Inventory/EventList";
import InventoryEventDetails from "./components/Inventory/EventDetail";
import Certifier from "./components/Certifier";
import OnboardingIntermediate from "./components/Inventory/OnboardingIntermediate"
import ProductDetails from "./components/MarketPlace/ProductDetail";
import Checkout from "./components/MarketPlace/AddCart";
import ConfirmOrder from "./components/MarketPlace/ConfirmOrder";
import EventSerialNumberList from "./components/Event/EventSerialNumberList";
import ProcessingOrder from "./components/MarketPlace/ProcessingOrder";
import Invoice from "./components/Order/Invoice";
import { CertifiersProvider } from "./contexts/certifier";
import LoginRedirect from "./components/LoginRedirect";

const AuthenticatedRoutes = ({ user, users }) => {
  return (
    <Routes>
      <Route
        exact
        path={routes.Marketplace.url}
        element={
          <UsersProvider>
            <CategorysProvider>
              <MarketPlace user={user} users={users} />
            </CategorysProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.LoginRedirect.url}
        element={
          <LoginRedirect/>
        }
      />
      <Route
        exact
        path={routes.Checkout.url}
        element={
          <UsersProvider>
            <CategorysProvider>
              <OrdersProvider>
                <Checkout user={user} users={users} />
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
                  <ConfirmOrder user={user} users={users} />
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
              <Invoice user={user} users={users} />
            </OrdersProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.Certifier.url}
        element={
          <UsersProvider>
            <CertifiersProvider>
              <EventTypesProvider>
                <EventsProvider>
                  <Certifier user={user} users={users} />
                </EventsProvider>
              </EventTypesProvider>
            </CertifiersProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.MarketplaceProductList.url}
        element={
          <UsersProvider>
            <CategorysProvider>
              <SubCategorysProvider>
                <ProductsProvider>
                  <CategoryProductList user={user} users={users} />
                </ProductsProvider>
              </SubCategorysProvider>
            </CategorysProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.MarketplaceProductDetail.url}
        element={
          <UsersProvider>
            <EventsProvider>
              <CategorysProvider>
                <SubCategorysProvider>
                  <InventoriesProvider>
                    <ItemsProvider>
                      <ProductDetails user={user} users={users} />
                    </ItemsProvider>
                  </InventoriesProvider>
                </SubCategorysProvider>
              </CategorysProvider>
            </EventsProvider>
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
        path={routes.Inventories.url}
        element={
          <UsersProvider>
            <CertifiersProvider>
              <CategorysProvider>
                <SubCategorysProvider>
                  <EventTypesProvider>
                    <EventsProvider>
                      <ItemsProvider>
                        <ProductsProvider>
                          <InventoriesProvider>
                            <Inventory user={user} users={users} />
                          </InventoriesProvider>
                        </ProductsProvider>
                      </ItemsProvider>
                    </EventsProvider>
                  </EventTypesProvider>
                </SubCategorysProvider>
              </CategorysProvider>
            </CertifiersProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.InventoryDetail.url}
        element={
          <UsersProvider>
            <EventsProvider>
              <CategorysProvider>
                <SubCategorysProvider>
                  <InventoriesProvider>
                    <ItemsProvider>
                      <ProductDetails user={user} users={users} />
                    </ItemsProvider>
                  </InventoriesProvider>
                </SubCategorysProvider>
              </CategorysProvider>
            </EventsProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.OnboardingSellerToStripe.url}
        element={
          <UsersProvider>
            <InventoriesProvider>
              <OnboardingIntermediate user={user} users={users} />
            </InventoriesProvider>
          </UsersProvider>
        }
      />
      {/* <Route
        exact
        path={routes.EventList.url}
        element={
          <UsersProvider>
            <EventsProvider>
              <EventList user={user} users={users} />
            </EventsProvider>
          </UsersProvider>
        }
      /> */}
      {/* <Route
        exact
        path={routes.InventoryEventDetail.url}
        element={
          <UsersProvider>
            <EventTypesProvider>
              <EventsProvider>
                <InventoryEventDetails user={user} users={users} />
              </EventsProvider>
            </EventTypesProvider>
          </UsersProvider>
        }
      /> */}
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
        path={routes.Orders.url}
        element={
          <UsersProvider>
            <OrdersProvider>
              <Order user={user} users={users} />
            </OrdersProvider>
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
        path={routes.SoldOrderItemDetail.url}
        element={
          <UsersProvider>
            <OrdersProvider>
              <SoldOrderItemDetail user={user} users={users} />
            </OrdersProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.BoughtOrderItemDetail.url}
        element={
          <UsersProvider>
            <OrdersProvider>
              <BoughtOrderItemDetail user={user} users={users} />
            </OrdersProvider>
          </UsersProvider>
        }
      />
      <Route
        exact
        path={routes.OrderItemEventsList.url}
        element={
          <UsersProvider>
            <OrdersProvider>
              <EventsProvider>
                <OrderItemEventsList user={user} users={users} />
              </EventsProvider>
            </OrdersProvider>
          </UsersProvider>
        }
      />
      {/* <Route
        exact
        path={routes.Events.url}
        element={
          <UsersProvider>
            <CertifiersProvider>
              <CategorysProvider>
                <SubCategorysProvider>
                  <ProductsProvider>
                    <EventTypesProvider>
                      <EventsProvider>
                        <Event user={user} users={users} />
                      </EventsProvider>
                    </EventTypesProvider>
                  </ProductsProvider>
                </SubCategorysProvider>
              </CategorysProvider>
            </CertifiersProvider>
          </UsersProvider>
        }
      /> */}
      {/* <Route
        exact
        path={routes.EventDetail.url}
        element={
          <UsersProvider>
            <EventsProvider>
              <EventDetails user={user} users={users} />
            </EventsProvider>
          </UsersProvider>
        }
      /> */}
      {/* <Route
        exact
        path={routes.EventSerialNumberList.url}
        element={
          <UsersProvider>
            <EventsProvider>
              <EventSerialNumberList user={user} users={users} />
            </EventsProvider>
          </UsersProvider>
        }
      /> */}
      <Route
        exact
        path={routes.InventoryEventSerialNumberList.url}
        element={
          <UsersProvider>
            <EventsProvider>
              <EventSerialNumberList user={user} users={users} />
            </EventsProvider>
          </UsersProvider>
        }
      />
      <Route
        path="/"
        element={<Navigate
          to={"/marketplace"}
          replace />}
      />
      <Route
        path="*"
        element={<Navigate
          to={"/"}
          replace />}
      />
    </Routes>
  );
};

export default AuthenticatedRoutes;
