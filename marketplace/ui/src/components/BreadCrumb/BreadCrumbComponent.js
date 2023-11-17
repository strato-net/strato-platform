import { useLocation, useNavigate } from "react-router-dom";
import { Breadcrumb, Col, Row, Typography } from "antd";
import React from "react";

import ClickableCell from "../ClickableCell";
const { Text } = Typography;

const BreadCrumbComponent = ({ name }) => {
  const { pathname } = useLocation();
  const navigate = useNavigate();

  const isMarketplace = pathname.includes("all");
  const routesArray = pathname.split("/");

  const handleRedirect = (e, item) => {
    e.preventDefault();
    if (isMarketplace) {
      navigate("/category/Membership");
    } else if (item === "/memberships/serviceUsage") {
    } else {
      navigate(item || "/marketplace");
    }
  };

  return (
    <>
      <Row className="mx-16 h-20">
        <Col span={24} className="mt-10">
          <Breadcrumb>
            {routesArray.map((item, index) => {
              let len = routesArray.length - 1;
              if (item === "all") {
                return null;
              }
              return (
                <Breadcrumb.Item
                  key={index}
                  href=""
                  onClick={(e) =>
                    handleRedirect(e, routesArray.slice(0, index + 1).join("/"))
                  }
                >
                  <ClickableCell>
                    <Text
                      className={`${
                        len == index ? "" : "text-primary"
                      } capitalize text-md font-bold`}
                      underline
                    >
                      {item == "" && index == 0
                        ? "Home"
                        : name && index == len
                        ? name
                        : decodeURIComponent(item)}
                    </Text>
                  </ClickableCell>
                </Breadcrumb.Item>
              );
            })}
          </Breadcrumb>
        </Col>
      </Row>
    </>
  );
};

export default BreadCrumbComponent;
