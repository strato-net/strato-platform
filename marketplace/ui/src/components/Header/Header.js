import React, { useState, useEffect, useMemo } from "react";
import {
  Layout,
  Input,
  Menu,
  Image,
  Space,
  Badge,
  Avatar,
  Dropdown,
} from "antd";
import { SearchOutlined, ShoppingCartOutlined } from "@ant-design/icons";
import { Images } from "../../images";
import { Wallet } from "../../images/SVGComponents";
import "./header.css";
import { useNavigate } from "react-router-dom";
import routes from "../../helpers/routes";
import {
  useMarketplaceState,
  useMarketplaceDispatch,
} from "../../contexts/marketplace";
import { actions } from "../../contexts/marketplace/actions";
import { actions as userActions } from "../../contexts/authentication/actions";
import { useAuthenticateDispatch } from "../../contexts/authentication";
import { USER_ROLES } from "../../helpers/constants";

const { Header } = Layout;

const HeaderComponent = ({ user }) => {
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

  const [selectedTab, setSelectedTab] = useState("0");
  const [initials, setInitials] = useState("");
  const [roleIndex, setRoleIndex] = useState()


  const navItems = [
    {
      role: USER_ROLES[1],
      items: [
        "Marketplace",
        "Orders",
        "Inventory",
        "Products",
        "Events",
        "Admin"
      ]
    },
    {
      role: USER_ROLES[2],
      items: [
        "Marketplace",
        "Orders",
        "Inventory",
        "Products",
        "Events"
      ]
    },
    {
      role: USER_ROLES[3],
      items: []
    },
    {
      role: "",
      items: []
    },
  ];

  const navUrls = [
    routes.Marketplace.url,
    routes.Orders.url,
    routes.Inventories.url,
    routes.Products.url,
    routes.Events.url,
    routes.Admin.url,
  ];

  const logout = () => {
    userActions.logout(userDispatch);
  };

  useEffect(() => {
    let pathName = window.location.pathname;
    if (pathName.includes("/marketplace")) {
      setSelectedTab("0");
    } else if (pathName.includes("/order") || pathName.includes("/orders") || pathName.includes('sold-orders') || pathName.includes('bought-orders')) {
      setSelectedTab("1");
    } else if (pathName.includes("/inventories")) {
      setSelectedTab("2");
    } else if (pathName.includes("/products")) {
      setSelectedTab("3");
    } else if (pathName.includes("/events") || pathName === "/certifier") {
      setSelectedTab("4");
    } else if (pathName.includes("/admin")) {
      setSelectedTab("5");
    }
  }, [window.location.pathname]);

  const items = user?.roles.includes(USER_ROLES[1]) ? [
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
        <div type="text" className="w-full text-secondryB text-sm !hover:bg-success" onClick={logout}>
          Logout
        </div>
      ),
    },
  ] : [
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
      key: '3',
      label: (
        <div onClick={() => { navigate(routes.ManageRole.url) }}>
          <p>
            Manage Role
          </p>
        </div>
      ),
    },
    {
      key: '1',
      label: (
        <div type="text" className="w-full text-secondryB text-sm !hover:bg-success" onClick={logout}>
          Logout
        </div>
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
  }, [user])

  useEffect(() => {
    if (user?.roles.includes(USER_ROLES[1])) setRoleIndex(0)
    else if (user?.roles.length === 1 && user?.roles.includes(USER_ROLES[3])) setRoleIndex(2)
    // else if (user?.roles.includes("Trading Entity")) setRoleIndex(0)
    else if (user?.roles.length === 0) setRoleIndex(3);
    else if (user?.roles) setRoleIndex(1)

  }, [user])

  return (
    <Header className="!bg-primary flex">
      <Space>
        <div
          className="mt-6 cursor-pointer"
          onClick={() => {
            if (roleIndex !== 2 && roleIndex !== 3) navigate(routes.Marketplace.url)
          }}
        >
          <Image src={Images.logo} width={35} preview={false} />
        </div>
        {roleIndex === undefined || roleIndex === 2 || roleIndex === 3 ? null : <div className="ml-7 w-72">
          <Input
            size="large"
            placeholder="Search"
            prefix={<SearchOutlined style={{ color: "#989898" }} />}
          />
        </div>}
      </Space>
      <Menu
        mode="horizontal"
        defaultSelectedKeys={["0"]}
        selectedKeys={[selectedTab]}
        disabledOverflow={true}
        className="h-16 bg-primary text-tertiaryB m-auto"
        onClick={(item) => {
          setSelectedTab(item.key)
          if (item.key === "4") navigate(navUrls[item.key], { state: { tab: "EventType" } })
          else navigate(navUrls[item.key]);
        }}
      >
        {navItems[roleIndex]?.items.map((item, index) => {
          return (
            <Menu.Item id={item} key={index}>
              {item}
            </Menu.Item>
          );
        })}
      </Menu>
      <Space size="large">
        {roleIndex === undefined || roleIndex === 2 || roleIndex === 3 ? null : <Badge
          className="cursor-pointer"
          count={cartList.length}
          onClick={() => navigate("/marketplace/checkout")}
        >
          <Avatar
            style={{
              backgroundColor: "#181EAC",
            }}
            icon={<ShoppingCartOutlined />}
          />
        </Badge>
        }
        <Dropdown  menu={{ items }} placement="bottomLeft" trigger={["click"]} overlayStyle={{ marginTop: "40px" }}>
          <a onClick={(e) => e.preventDefault()} className="text-base text-white" id="dropdown">
            {initials}
          </a>
        </Dropdown>
      </Space>
    </Header>
  );
};

export default HeaderComponent;
