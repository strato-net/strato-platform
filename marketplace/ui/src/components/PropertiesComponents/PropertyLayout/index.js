import React, { useState } from "react"
import {
  Collapse,
  Button,
  Layout,
} from "antd";
import Filter from "../Filter";

const { Header } = Layout;

const PropertyLayout = ({ children }) => {

  return (
    <Layout>
      <Header
        className='flex justify-end'
        style={{
          display: "flex",
          alignItems: "center",
          backgroundColor: "#001B71"
        }}>
        <Button style={{ backgroundColor: '#FD3200', color: '#FFFFFF' }}>
          List Property
        </Button>
      </Header>
      {children}
    </Layout>
  );
}

export default PropertyLayout;