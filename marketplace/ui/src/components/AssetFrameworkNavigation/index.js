import React from "react";
import { Link } from "react-router-dom";
import { Menu } from "antd";
import { AppstoreOutlined } from "@ant-design/icons";
import routes from "../../helpers/routes";

const AssetFrameworkNavigation = ({ isAuthenticated }) => {

  const assets = [
    { 
      ...routes.Categorys,
      icon: <AppstoreOutlined />,
    },
    { 
      ...routes.SubCategorys,
      icon: <AppstoreOutlined />,
    },
    { 
      ...routes.Products,
      icon: <AppstoreOutlined />,
    },
    { 
      ...routes.Inventorys,
      icon: <AppstoreOutlined />,
    },
    { 
      ...routes.Items,
      icon: <AppstoreOutlined />,
    },
    { 
      ...routes.Orders,
      icon: <AppstoreOutlined />,
    },
    { 
      ...routes.OrderLineItems,
      icon: <AppstoreOutlined />,
    },
    { 
      ...routes.EventTypes,
      icon: <AppstoreOutlined />,
    },
    { 
      ...routes.Events,
      icon: <AppstoreOutlined />,
    },
];

const menuItems = assets.map((asset) => (
  {
    label: ( 
      <Link to={asset.url}>{asset.label}</Link>
      ), 
    key: asset.name,
    icon: asset.icon,
  }
));

return (
  <>
    <Menu
      mode="inline"
      items={isAuthenticated ? menuItems : []}
    />
  </>
);
};

export default AssetFrameworkNavigation;
