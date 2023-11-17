import React, { useState, useEffect, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import TagManager from "react-gtm-module";
import {
  Layout,
  Input,
  Menu,
  Space,
  Badge,
  Avatar,
  Dropdown,
  Typography,
} from "antd";
import { SearchOutlined, ShoppingCartOutlined, PlusCircleOutlined } from "@ant-design/icons";

import "./header.css";
import routes from "../../helpers/routes";
// Actions
import { actions as marketplaceActions } from "../../contexts/marketplace/actions";
import { actions as userActions } from "../../contexts/authentication/actions";
// Dispatch and States
import { useMarketplaceState, useMarketplaceDispatch } from "../../contexts/marketplace";
import { useAuthenticateDispatch, useAuthenticateState } from "../../contexts/authentication";
// icons
import { blockappLogo } from "../../images/SVGComponents";
import { setCookie } from "../../helpers/cookie";

const { Title } = Typography;
const { Header } = Layout;

const HeaderComponent = ({ isOauth, user, loginUrl }) => {
  const navigate = useNavigate();
  const location = useLocation();

  const marketplaceDispatch = useMarketplaceDispatch();
  const userDispatch = useAuthenticateDispatch();
  const { isAuthenticated, isCheckingAuthentication } = useAuthenticateState();
  const { cartList } = useMarketplaceState();

  const storedData = useMemo(() => {
    return window.localStorage.getItem("cartList") == null ? [] : JSON.parse(window.localStorage.getItem("cartList"));
  }, []);

  useEffect(() => {
    marketplaceActions.fetchCartItems(marketplaceDispatch, storedData);
  }, [marketplaceDispatch, storedData]);

  const [selectedTab, setSelectedTab] = useState("0");
  const [initials, setInitials] = useState("");
  const [roleIndex, setRoleIndex] = useState();

  // const showStorage = user && user.organization && user.organization === "BlockApps" ? true : false

  const navItems = [
    {
      role: 0,
      items: [
        { label: <div id="Marketplace">Marketplace</div>, key: '0' },
        { label: <div id="Orders">Orders</div>, key: '1' },
        // { label: <div id="Inventory">Inventory</div>, key: '2' },
        // { label: <div id="Products">Products</div>, key: '3' },
        { label: <div id="Products">Memberships</div>, key: '5' },
        // { label: <div id="Events">Events</div>, key: '4' },        
        // showStorage && { label: <div id="Storage">Storage</div>, key: '5' },
      ]
    },
    {
      role: 1,
      items: [
        { label: <div id="Marketplace"></div>, key: '0' },
      ]
    },
  ];

  const navUrls = [
    routes.Marketplace.url,
    routes.Orders.soldOrders,
    routes.Inventories.url,
    routes.Products.url,
    routes.Events.url,
    routes.purchasedMemberships.url,
    routes.Storage.url,
  ];

  const logout = () => {
    TagManager.dataLayer({
      dataLayer: {
        event: 'logout',
      },
    });
    userActions.logout(userDispatch);
  };

  useEffect(() => {
    if (!isAuthenticated && !user && loginUrl) {
      const unauthorizedRedirectUrls = [
        '/order', '/products', '/purchased', '/issued', "/checkout"
      ];

      const pathName = location.pathname;

      if (unauthorizedRedirectUrls.some(url => pathName.includes(url))) {
        navigate(routes.Marketplace.url);
      }
    }
  }, [isCheckingAuthentication]);

  useEffect(() => {
    let pathName = window.location.pathname;
    // if (pathName.includes("/marketplace")) {
    //   setSelectedTab("0");
    // } else 
    if (pathName.includes("/order")) {
      setSelectedTab("1");
    } else if (pathName.includes("/inventories")) {
      setSelectedTab("2");
    } else if (pathName.includes("/products")) {
      setSelectedTab("3");
    } else if (pathName.includes("/memberships")) {
      setSelectedTab("5");
    } else if (pathName.includes("/events") || pathName === "/certifier") {
      setSelectedTab("4");
    } else if (pathName.includes("/storage")) {
      setSelectedTab("5");
    }
    else {
      setSelectedTab("0");
    }
  }, [window.location.pathname]);

  const items = user ? [
    {
      key: '2',
      label: (
        <div>
          <p>
            {user == null ? "" : user.commonName}
          </p>
          <p className="text-xs">
            {user == null ? "" : user.preferred_username}
          </p>
        </div>
      ),
    },
    {
      key: '1',
      label: (
        <div type="text" id="logout" className="w-full text-secondryB text-sm !hover:bg-success" onClick={logout}>
          Logout
        </div>
      ),
    },
  ] : [
    {
      key: '2',
      label: (
        <a href={loginUrl}> Login </a>
      ),
    },
  ];

  useEffect(() => {
    let temp = "";
    if (user != null) {
      if (user.commonName.split(" ").length > 1) {
        temp = user.commonName.split(" ")[0].substring(0, 1) + user.commonName.split(" ")[1].substring(0, 1);
      } else {
        temp = user.commonName.split(" ")[0].substring(0, 1);
      }
    }
    setInitials(temp);
  }, [user]);

  useEffect(() => {
    if (user) setRoleIndex(0)
    else setRoleIndex(1)
  }, [user]);

  return (
    <Header className="!bg-white flex shadow-lg">
      <Space>
        <div
          className=" cursor-pointer"
          onClick={() => { navigate(routes.Marketplace.url) }}
        >
          {blockappLogo()}
        </div>
        {((roleIndex === undefined || roleIndex === 1) && !isOauth) ? null : <div className="ml-7 w-72">
          <Input
            size="large"
            placeholder="Search"
            className="header-search rounded-full"
            prefix={<SearchOutlined style={{ color: "#989898" }} />}
          />
        </div>}
      </Space>
      <Menu
        mode="horizontal"
        defaultSelectedKeys={["0"]}
        selectedKeys={[selectedTab]}
        disabledOverflow={true}
        className="h-16 decoration-black m-auto"
        onClick={(item) => {
          const events = [
            'view_marketplace_page',
            'view_orders_page',
            'view_inventory_page',
            'view_products_page',
            'view_events_page',
            'view_storage_page',
          ];

          setCookie("returnUrl", `/marketplace${navUrls[item.key]}`, 10);
          setSelectedTab(item.key);
          TagManager.dataLayer({
            dataLayer: {
              event: events[item.key],
            },
          });

          if (item.key === 4) {
            navigate(navUrls[item.key], { state: { tab: "EventType" } });
          } else {
            navigate(navUrls[item.key]);
          }
        }}
        items={navItems[roleIndex]?.items}
      />
      <Space size="large">
        {roleIndex === undefined || roleIndex === 1 ? null : <Badge
          className="cursor-pointer"
          onClick={() => {
            navigate("/memberships/purchased", { state: { isCalledFromHeader: true } });
          }}
        >
          <Avatar
            style={{
              backgroundColor: "transparent",
              color: 'black'
            }}
            icon={<PlusCircleOutlined />}
          />
        </Badge>
        }
        {roleIndex === undefined || roleIndex === 1 ? null : <Badge
          className="cursor-pointer"
          count={cartList?.length}
          onClick={() => {
            setCookie("returnUrl", `/marketplace/checkout`, 10);
            TagManager.dataLayer({
              dataLayer: {
                event: 'view_shopping_cart',
              },
            });
            navigate("/checkout");
          }}
        >
          <Avatar
            style={{
              backgroundColor: "transparent",
              color: 'black'
            }}
            icon={<ShoppingCartOutlined />}
          />
        </Badge>
        }
        {
          roleIndex === undefined || roleIndex === 1 ? (
            loginUrl ? <a href={loginUrl} id="Login" className="text-base text-white"
              onClick={() => {
                TagManager.dataLayer({
                  dataLayer: {
                    event: 'login_register_click'
                  }
                })
              }} >
              <Typography className="primary-theme-text">Login / Register</Typography>
            </a> : (isOauth ? <Title style={{ border: 3, padding: 10, color: '#FFFFFF' }} level={3} >Something went wrong, try to refresh page</Title> : null)
          ) :
            <Dropdown menu={{ items }} placement="bottomLeft" trigger={["click"]} overlayStyle={{ marginTop: "40px" }}>
              <a onClick={(e) => e.preventDefault()} className="text-base text-black" id="user-dropdown">
                {initials}
              </a>
            </Dropdown>
        }
      </Space>
    </Header>
  );
};

export default HeaderComponent;
