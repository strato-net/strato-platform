import React from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Breadcrumb, Col, Row, Typography } from "antd";

import ClickableCell from "../ClickableCell";
const { Text } = Typography;

const BreadCrumbComponent = ({ name }) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const isMarketplace = pathname.includes("all");
  const routesArray = pathname.split("/");
  const routesLength = routesArray.length - 1;

  const handleRedirect = (index) => {
    const redirectPath = routesArray.slice(0, index + 1).join("/");
    if (isMarketplace) {
      if (!redirectPath) {
        navigate("/marketplace");
        return;
      }
      navigate("/category/Membership");
    } else {
      navigate(redirectPath || "/marketplace");
    }
  };

  const getBreadCrumbText = (item, index) => {
    if (item === "" && index === 0) {
      return "Home";
    }
    if (name && index === routesLength) {
      return name;
    }
    return decodeURIComponent(item);
  };

  const BreadCrumbItem = ({ item, index }) => {
    if (item === "all" || (index === routesLength && item === "")) {
      return null;
    }

    return (
      <Breadcrumb.Item
        key={index}
        href=""
        onClick={(e) => {
          e.preventDefault();
          handleRedirect(index);
        }}
      >
        <ClickableCell>
          <Text
            className={`${routesLength !== index && "text-primary"
              } capitalize text-md font-bold`}
            underline
          >
            {getBreadCrumbText(item, index)}
          </Text>
        </ClickableCell>
      </Breadcrumb.Item>
    );
  };

  return (
    <Row className="mx-16 h-20">
      <Col span={24} className="mt-10">
        <Breadcrumb>
          {routesArray.map((item, index) => (
            <BreadCrumbItem item={item} index={index} key={index} />
          ))}
        </Breadcrumb>
      </Col>
    </Row>
  );
};

export default BreadCrumbComponent;
