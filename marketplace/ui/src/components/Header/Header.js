import React, { useState, useEffect, useMemo } from "react";
import {
  Layout,
  Input,
  Menu,
  Space,
  Badge,
  Avatar,
  Dropdown,
  Button,
  Typography
} from "antd";
import { ArrowLeftOutlined, LogoutOutlined } from "@ant-design/icons";
import { Images } from "../../images";
import "./header.css";
import { useLocation, useNavigate } from "react-router-dom";
import routes from "../../helpers/routes";
import {
  useMarketplaceState,
  useMarketplaceDispatch,
} from "../../contexts/marketplace";
import { actions } from "../../contexts/marketplace/actions";
import { actions as userActions } from "../../contexts/authentication/actions";
import { useAuthenticateDispatch } from "../../contexts/authentication";
import TagManager from "react-gtm-module";

const { Header } = Layout;

const HeaderComponent = ({ user, loginUrl, showMenu, handleSubMenu, handleMenuTab }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const queryParams = new URLSearchParams(location.search);
  const categoryQueryValue = queryParams.get('category');
  const searchQueryValue = queryParams.get('search');

  const marketplaceDispatch = useMarketplaceDispatch();
  const userDispatch = useAuthenticateDispatch();
  const { cartList, strats } = useMarketplaceState();

  const storedData = useMemo(() => {
    return window.localStorage.getItem("cartList") == null ? [] : JSON.parse(window.localStorage.getItem("cartList"));
  }, []);

  useEffect(() => {
    if (user) {
      actions.fetchStratsBalance(marketplaceDispatch);
    }
  }, [user]);

  useEffect(() => {
    actions.fetchCartItems(marketplaceDispatch, storedData);
  }, [marketplaceDispatch, storedData]);

  const [selectedTab, setSelectedTab] = useState("0");
  const [initials, setInitials] = useState("");
  const [roleIndex, setRoleIndex] = useState();
  const [showSearch, setShowSearch] = useState(false)

  const strato = (Object.keys(strats).length > 0) ? strats : 0

  const navItems = [
    {
      role: 0,
      items: [
        { label: <div id="Marketplace">Marketplace</div>, key: '0' },
        { label: <div id="Orders">Orders</div>, key: '1' },
        { label: <div id="Inventory">My Store</div>, key: '2' }
      ]
    },
    {
      role: 1,
      items: [
        { label: <div id="Marketplace">Marketplace</div>, key: '0' },
      ]
    },
  ];

  const navUrls = [
    routes.Marketplace.url,
    routes.Orders.url.replace(':type', 'sold'),
    routes.MyStore.url,
    routes.Products.url,
    routes.Events.url,
  ];

  const logout = () => {
    window.LOQ = window.LOQ || []
    window.LOQ.push(['ready', async LO => {
      // Track an event
      await LO.$internal.ready('events')
      LO.events.track('Logout')
    }])
    TagManager.dataLayer({
      dataLayer: {
        event: 'logout',
      },
    });
    userActions.logout(userDispatch);
  };

  useEffect(() => {
    let pathName = window.location.pathname;
    if (pathName.includes("/order") || pathName.includes("/orders") || pathName.includes('sold-orders') || pathName.includes('bought-orders')) {
      setSelectedTab("1");
    } else if (pathName.includes("/mystore")) {
      setSelectedTab("2");
    } else if (pathName.includes("/products")) {
      setSelectedTab("3");
    } else if (pathName.includes("/events") || pathName === "/certifier") {
      setSelectedTab("4");
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
            {user == null ? "" : user.email}
          </p>
        </div>
      ),
    },
    {
      key: '1',
      label: (
        <div type="text" id="logout" className="w-full text-secondryB text-sm !hover:bg-success flex gap-2 items-center" onClick={logout}>
          <div className="-rotate-90"><LogoutOutlined /></div>
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

  const stratoItem = [{
    key: '2',
    label: (
      <div>
        {user &&
          <p className="text-xs mt-1">
            STRATS: {(Object.keys(strats).length > 0) ? strats : 0}
          </p>
        }
      </div>
    ),
  }]

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
  }, [user])

  useEffect(() => {
    if (user) setRoleIndex(0)
    else setRoleIndex(1)
  }, [user])

  const subMenuItems = [
    { value: "marketplace", path: routes.MarketplaceProductList.url, label: "Marketplace" },
    { value: "orders", path: routes.Orders.url.replace(':type', 'sold'), label: "Orders" },
    { value: "mystore", path: "/mystore", label: "My Store" },
    user ? { value: "logout", path: "/logout", label: <div><p className="!mb-0">Logout</p><p className="text-xs text-gray">{user?.preferred_username}</p></div> } : null,
  ]

  const handleIntMenuTab = (data) => {
    data.value == 'logout' ? logout() : data.value == 'orders' ? navigate(routes.Orders.url.replace(':type', 'sold'), { state: { defaultKey: "Sold" } }) : navigate(data.path)
    handleMenuTab(data)
  }

  const handleSearchShow = (status) => {
    setShowSearch(status)
  }

  const navigateSearch = (value) => {
    const baseUrl = new URL('/category', window.location.origin);

    if (categoryQueryValue) {
      baseUrl.searchParams.set('category', categoryQueryValue);
    }
    if (value.length > 0) {
      baseUrl.searchParams.set('search', value);
    }

    const url = baseUrl.pathname + baseUrl.search;
    navigate(url, { replace: true });
  }

  const handleChangeSearch = (e) => {
    const value = e.target.value;
    if (value.length === 0 && searchQueryValue) {
      navigateSearch(value)
    }
  }

  const handleEnterSearch = (e) => {
    const value = e.target.value;
    navigateSearch(value)
  };

  return (
    <>
      <Header className={`fixed z-[100] !bg-[#ffffff] !pl-2 w-full !pr-4 md:px-12 flex md:!mb-10 ${showMenu ? '' : 'shadow-header'} md:p-10 justify-between md:justify-start`}>
        <Space className="relative flex-grow-0 md:flex-1 ml-2 md:ml-5">
          <div
            className="mt-4 mr-5 md:mt-0 cursor-pointer flex-grow-0 w-max md:w-[170px] h-[44px]"
            onClick={() => { navigate(routes.Marketplace.url) }}
          >
            <img src={Images.newLogo} className="h-[31px] w-[120px] md:w-[170px] md:h-[44px]" preview={false} />
          </div>
          <div className={`lg:ml-28 md:ml-1 flex-1 ${showSearch ? '-mt-[6px] fixed top-[13px] left-0 flex w-[100vw] z-50 mb-4' : 'hidden md:flex mb-10'}`}>
            <Input
              // key={searchQueryValue}
              size="large"
              placeholder="Search"
              // defaultValue={searchQueryValue}
              onChange={(e) => { handleChangeSearch(e) }}
              onPressEnter={(e) => { handleEnterSearch(e) }}
              prefix={showSearch ? <ArrowLeftOutlined onClick={() => handleSearchShow(false)} /> : <img src={Images.Header_Search} className="w-[18px] h-[18px]" />}
              className="bg-[#F6F6F6] border-none rounded-[100px] md:!w-[35%] lg:w-[40%] absolute p-[10px] "
            />
          </div>
        </Space>
        <Menu
          mode="horizontal"
          defaultSelectedKeys={["0"]}
          selectedKeys={[selectedTab]}
          disabledOverflow={true}
          className="h-16 bg-white text-base mx-10 -mt-7 md:flex hidden"
          onClick={(item) => {
            setSelectedTab(item.key)
            // These pages will be tracked automatically with lucky orange, no need to create an event here unluess we want to include additional metadata
            if (item.key === "0") {
              TagManager.dataLayer({
                dataLayer: {
                  event: 'view_marketplace_page',
                },
              });
            }
            if (item.key === "1") {
              TagManager.dataLayer({
                dataLayer: {
                  event: 'view_orders_page',
                },
              });
            }
            if (item.key === "2") {
              TagManager.dataLayer({
                dataLayer: {
                  event: 'view_inventory_page',
                },
              });
            }
            if (item.key === "3") {
              TagManager.dataLayer({
                dataLayer: {
                  event: 'view_products_page',
                },
              });
            }
            if (item.key === "4") {
              TagManager.dataLayer({
                dataLayer: {
                  event: 'view_events_page',
                },
              });
              navigate(navUrls[item.key], { state: { tab: "EventType" } })
            }
            else navigate(navUrls[item.key]);
          }}
          items={navItems[roleIndex]?.items}
        />
        <Space size="large" className="!gap-0 md:!gap-4 mr-0 -ml-3">
          {<div className="flex md:hidden mx-2" onClick={() => handleSearchShow(true)}>
            <img src={Images.Responsive_search} className="w-6 h-6" />
          </div>}
          {roleIndex === undefined || roleIndex === 1 ? null : <Badge
            className="cursor-pointer"
            count={cartList.length}
            onClick={() => {
              TagManager.dataLayer({
                dataLayer: {
                  event: 'view_shopping_cart',
                },
              });
              navigate("/checkout");
            }}
          >
            <div className="md:hidden">
              <Avatar
                icon={<img src={Images.Responsive_cart} alt="" className="w-6 h-6" />}
              />
            </div>
            <div className="hidden md:inline-block">
              <Avatar
                icon={<img src={Images.Header_cart} alt="" className="w-6 h-6" />}
              />
            </div>
          </Badge>
          }

          {(roleIndex !== undefined && roleIndex !== 1)
            && <Dropdown menu={{ items: stratoItem }} placement="bottomRight" trigger={["hover","click"]} className="xs:mt-5 md:mt-0" overlayStyle={{ position: 'fixed' }}>
              <a onClick={(e) => e.preventDefault()} className="md:flex mx-2 text-base text-white" id="user-dropdown">
              <Badge
              color="grey"
              className="cursor-pointer mt-7 md:mt-0 mx-2"
              count={strats}
              overflowCount={9999999}
              >
              <img src={Images.logo} className="w-[30px] h-[30px] " />
            </Badge>
              </a>
            </Dropdown>
          }
          {
            roleIndex === undefined || roleIndex === 1 ? (
              loginUrl ? <a href={loginUrl} id="Login" className="text-base text-white flex gap-3 items-center"
                onClick={() => {
                  TagManager.dataLayer({
                    dataLayer: {
                      event: 'login_register_click'
                    }
                  })
                }} >
                <Button size="large" className="hidden sm:flex login_btn w-[70%] md:w-[100%] hover:bg-primary">Login</Button>
                <Button size="large" className="hidden sm:flex bg-primary text-white w-[70%] md:w-[100%]">Register</Button>
                <Button size="large" className="flex sm:hidden bg-primary text-white w-[90%] !h-[25%] !text-sm justify-center items-center">Login/Register</Button>
              </a> : null
            ) :
              <Dropdown menu={{ items }} placement="bottomRight" trigger={["click"]} overlayStyle={{ marginTop: "40px", position:'fixed' }}>
                <a onClick={(e) => e.preventDefault()} className="hidden md:flex text-base text-white" id="user-dropdown">
                  <img src={Images.Setting_icon} className="w-[30px] h-[30px] " />
                </a>
              </Dropdown>
          }
          {<div className="block md:hidden px-1" onClick={handleSubMenu}>
            <img src={Images.menu_icon} alt="" className="w-6 h-6" />
          </div>}
        </Space>
      </Header>
      {showMenu &&
        <div>
          <div className="bg-white border-t border-[#E9E9E9] absolute w-full z-50 md:hidden top-16">
            {subMenuItems.map((item) => {
              return (
                <Typography onClick={() => handleIntMenuTab(item)} className={`text-base py-3 px-4 cursor-pointer ${item ? '' : 'hidden'}`} >{item?.label}</Typography>
              )
            })}
          </div>
          <div className="h-[100vh] w-full bg-[#00000020] absolute top-0 md:hidden z-40" onClick={handleMenuTab}></div>
        </div>
      }
    </>

  );
};

export default HeaderComponent;
