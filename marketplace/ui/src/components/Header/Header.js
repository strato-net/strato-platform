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
  Button,
  Modal,
  Row,
  Col,
} from "antd";
import { SearchOutlined, ShoppingCartOutlined } from "@ant-design/icons";
import { Images } from "../../images";
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
import TagManager from "react-gtm-module";
import { icons } from "../PropertiesComponents/assets/icons/icons";
const { carbon, arts, loyalty, property, sell } = icons;
const { Header } = Layout;

const HeaderComponent = ({ user, loginUrl }) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
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
  const [roleIndex, setRoleIndex] = useState();


  const navItems = [
    // {
    //   role: 0,
    //   items: [
        { label: <div id="Marketplace">Marketplace</div>, key: '0' },
        { label: <div id="Orders">Orders</div>, key: '1' },
        { label: <div id="Inventory">Inventory</div>, key: '2' },
        { label: <div id="Products">Products</div>, key: '3' },
        { label: <div id="Events">Events</div>, key: '4' },
    //   ]
    // }
  ];

  const menu = [
    { name: "arts", icon: arts, label: "arts", url: "" },
    { name: "property", icon: property, label: "property", url: "/properties" },
    { name: "carbon", icon: carbon, label: "carbon", url: "" },
    { name: "loyalty", icon: loyalty, label: "loyalty", url: "" }
  ]

  const navUrls = [
    routes.Marketplace.url,
    routes.Orders.url,
    routes.Inventories.url,
    routes.Products.url,
    routes.Events.url,
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
    let pathName = window.location.pathname;
    // if (pathName.includes("/marketplace")) {
    //   setSelectedTab("0");
    // } else 
    if (pathName.includes("/order") || pathName.includes("/orders") || pathName.includes('sold-orders') || pathName.includes('bought-orders')) {
      setSelectedTab("1");
    } else if (pathName.includes("/inventories")) {
      setSelectedTab("2");
    } else if (pathName.includes("/products")) {
      setSelectedTab("3");
    } else if (pathName.includes("/events") || pathName === "/certifier") {
      setSelectedTab("4");
    } else{
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
  }, [user])

  useEffect(() => {
    if (user) setRoleIndex(0)
    else setRoleIndex(1)
  }, [user])

  const redirect = () => {
    setOpen(false)
    navigate("/properties")
    // setTimeout(()=>{
    // }, 1000)
  }

  const isLogin = () => {

    if (loginUrl) {
      return <a href={loginUrl} id="Login" className="text-base text-white"
        onClick={() => {
          TagManager.dataLayer({
            dataLayer: {
              event: 'login_register_click'
            }
          })
        }} >
        Login / Register
      </a>
    }
  }

  return (
    <Header className="!bg-primary flex">
      <Space>
        <div
          className="mt-6 cursor-pointer"
          onClick={() => { navigate(routes.Marketplace.url) }}
        >
          <Image src={Images.logo} width={35} preview={false} />
        </div>
        {roleIndex === undefined || roleIndex === 1 ? null : <div className="ml-7 w-72">
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
        items={navItems}
      />

      <Space size="large">
        {roleIndex === undefined || roleIndex === 1
          ? null
          : <Button style={{ border: "none", marginTop: "20px" }} onClick={() => setOpen(true)}>
            {sell}
            {/* <Typography.Text style={{color:"white"}}> Sell</Typography.Text> */}
          </Button>}
        {roleIndex === undefined || roleIndex === 1
          ? null
          : <Badge
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
            <Avatar
              style={{
                backgroundColor: "#181EAC",
              }}
              icon={<ShoppingCartOutlined />}
            />
          </Badge>
        }
        {
          roleIndex === undefined || roleIndex === 1
            ? isLogin()
            : <Dropdown menu={{ items }} placement="bottomLeft" trigger={["click"]} overlayStyle={{ marginTop: "40px" }}>
              <a onClick={(e) => e.preventDefault()} className="text-base text-white" id="user-dropdown">
                {initials}
              </a>
            </Dropdown>
        }
      </Space>
      <Modal
        title="What kind of asset we are selling ?"
        centered
        open={open}
        onOk={() => setOpen(false)}
        onCancel={() => setOpen(false)}
        width={'400px'}
        height={'90%'}
        footer={false}
      >
        <Row gutter={[16, 16]} style={{ marginTop: "20px" }}>
          {menu.map((item, index) => {
            const {icon, label, url } = item
            return <Col className="menu-card" onClick={() => { redirect(url) }} 
            span={6} offset={3}
             key={index} style={{ display: "flex", padding: "8px" }}>
              <div style={{ margin: "auto" }}>
                <div style={{margin:"auto"}}>{icon}</div>
                <p style={{ textAlign: "center" }}>{label}</p>
              </div>
            </Col>
          })}
        </Row>
      </Modal>
    </Header>
  );
};

export default HeaderComponent;
