import React, { useState, useCallback } from "react";
import { Avatar, Dropdown } from "antd";
import { UserOutlined, LogoutOutlined } from "@ant-design/icons";
import { apiUrl, HTTP_METHODS } from "../../helpers/constants";

const AssetFrameworkTopBar = ({ user, logout }) => {

  const name = user !== undefined ? user.preferred_username || user.email : "";
  const menu = 
    {
      items: [
        { 
          label: ( <span onClick={ logout }>Logout</span> ),
          key: "logout",
          icon: ( <LogoutOutlined /> ),
        }
      ], 
      style: { width: "250px" }
   }
  
  return (
    <div style={{ display: "flex", justifyContent: "end", padding: "10px" }}>
      <Dropdown 
        menu={menu}
        trigger={["click"]}
        className="pointer-hover"
      >
        <div> 
          <Avatar 
          style={{
            backgroundColor: "#4d94ff",
            justifyContent: "center",
            alignItems: "center",
          }}
          icon={<UserOutlined />}
          />
          <span style={{ marginLeft: "10px" }}>{ name }</span>
        </div>
      </Dropdown>
    </div>
  )
};

export default AssetFrameworkTopBar;
