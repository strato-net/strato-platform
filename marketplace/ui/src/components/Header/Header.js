import React, { useState, useEffect, useMemo } from "react";
import {
  Badge,
} from "antd";
import {
  ShoppingCartOutlined,
  PlusCircleOutlined,
  MenuOutlined,
  UserOutlined,
  DollarOutlined,
  LogoutOutlined,
  PieChartOutlined,
  UnorderedListOutlined,
  BellOutlined,
  FireOutlined,
  QuestionOutlined,
  CaretDownOutlined
} from "@ant-design/icons";
import { Images } from "../../images";
import { useNavigate } from "react-router-dom";
import routes from "../../helpers/routes";
import {
  useMarketplaceState,
  useMarketplaceDispatch,
} from "../../contexts/marketplace";
import { actions } from "../../contexts/marketplace/actions";
import { actions as userActions } from "../../contexts/authentication/actions";
import { useAuthenticateDispatch } from "../../contexts/authentication";

const HeaderComponent = ({ isOauth, user, loginUrl }) => {
  const navigate = useNavigate();
  const marketplaceDispatch = useMarketplaceDispatch();
  const userDispatch = useAuthenticateDispatch();
  const { cartList } = useMarketplaceState();
  const storedData = useMemo(() => {
    return window.localStorage.getItem("cartList") == null ? [] : JSON.parse(window.localStorage.getItem("cartList"));
  }, []);

  useEffect(() => {
    actions.fetchCartItems(marketplaceDispatch, storedData);
  }, [marketplaceDispatch, storedData]);

  const [roleIndex, setRoleIndex] = useState();
  const [showAllProducts, setShowAllProducts] = useState(false);
  const [showMenu, setShowMenu] = useState(false);

  const logout = () => {
    TagManager.dataLayer({
      dataLayer: {
        event: 'logout',
      },
    });
    userActions.logout(userDispatch);
  };

  useEffect(() => {
    if (user) setRoleIndex(0)
    else setRoleIndex(1)
  }, [user])

  return (
    <div className="flex justify-between items-center fixed top-0 left-0 right-0 p-2 z-50" style={{ backgroundColor: "#001B71" }}>
      <div>
        <img src={Images.mercataLogo} className="ml-10 h-12 p-1 cursor-pointer" onClick={() => navigate("/")} />
      </div>
      {
        roleIndex === undefined || roleIndex === 1 ? (
          loginUrl ? <a href={loginUrl} id="Login" className="text-base text-white mr-6"> Login / Register </a> : null
        ) :
          <div className="flex items-center gap-12 mr-6 my-2">
            <div className="flex flex-col items-center">
              <PlusCircleOutlined className="text-white" style={{ fontSize: 22 }} />
              <p className="text-white text-xs">
                Sell
              </p>
            </div>
            <div className="flex flex-col items-center">
              <Badge
                className="cursor-pointer"
                count={cartList.length}
                onClick={() => navigate("/checkout")}
              >
                <ShoppingCartOutlined className="text-white" style={{ fontSize: 22 }} />
              </Badge>
              <p onClick={() => navigate("/checkout")} className="text-white text-xs cursor-pointer">
                Cart
              </p>
            </div>
            <div className="flex flex-col items-center cursor-pointer text-white" onClick={() => setShowMenu(!showMenu)}>
              <MenuOutlined style={{ fontSize: 22 }} />
              <p className="text-xs">
                Menu
              </p>
            </div>
            {showMenu &&
              <div className="bg-white w-72 h-screen fixed right-0" style={{ top: 70 }}>
                <div className="flex p-6 items-center gap-4 cursor-pointer border-b border-secondryC hover:bg-red">
                  <UserOutlined className="text-xl" />
                  Profile
                </div>
                <div
                  className="flex p-6 items-center gap-4 cursor-pointer border-b border-secondryC hover:bg-red"
                  onClick={() => {
                    navigate(routes.MyAssets.url);
                    setShowMenu(false);
                  }}
                >
                  <PieChartOutlined className="text-xl" />
                  My Assets
                </div>
                <div className="flex p-6 items-center gap-4 cursor-pointer border-b border-secondryC hover:bg-red">
                  <DollarOutlined className="text-xl" />
                  Payments
                </div>
                <div className="flex p-6 items-center gap-4 cursor-pointer border-b border-secondryC hover:bg-red">
                  <UnorderedListOutlined className="text-xl" />
                  Order History
                </div>
                <div className="flex p-6 items-center gap-4 cursor-pointer border-b border-secondryC hover:bg-red">
                  <BellOutlined className="text-xl" />
                  Notifications
                </div>
                <div className="p-6 border-b border-secondryC">
                  <div className="flex items-center gap-4 cursor-pointer" onClick={() => setShowAllProducts(!showAllProducts)}>
                    <FireOutlined className="text-xl" />
                    All Products
                    <CaretDownOutlined />
                  </div>
                  {showAllProducts &&
                    <div className="ml-16">
                      <p className="mt-2"> Art </p>
                      <p className="mt-2"> Carbon </p>
                      <p className="mt-2"> Properties </p>
                    </div>
                  }
                </div>
                <div className="flex p-6 items-center gap-4 cursor-pointer border-b border-secondryC hover:bg-red">
                  <QuestionOutlined className="text-xl" />
                  Help
                </div>
                <div
                  className="flex p-6 items-center gap-4 cursor-pointer hover:bg-red"
                  onClick={() => logout()}
                >
                  <LogoutOutlined className="text-lg" />
                  <p>
                    Sign Out
                  </p>
                  <p className="fixed right-2" style={{ fontSize: 10 }}>
                    ({user.preferred_username})
                  </p>
                </div>
              </div>
            }
          </div>
      }
    </div>
  );
};

export default HeaderComponent;
