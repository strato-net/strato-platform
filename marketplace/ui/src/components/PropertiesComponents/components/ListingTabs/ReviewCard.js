import React, { useEffect, useState } from "react";
import { Button, Typography, Space, Avatar, Form, Row, Image } from "antd";
import { UserOutlined, DownOutlined, UpOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { useAuthenticateState } from "../../../../contexts/authentication";
import { decodeURIComponentText, unixToDate } from "../../helpers/utils";
import star from "../../assets/icons/star.svg";

const ReviewCard = (props) => {
  const {
    review: { reviewerName, title, createdDate, rating, description, readmore },
    index,
  } = props;

  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();

  return (
    <>
      <Space
        direction="vertical"
        size="small"
        style={{ marginTop: "30px", width: "400px" }}
        key={index}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Typography.Text type="secondary">
            <Avatar size="small" icon={<UserOutlined />} />
            <Typography.Text type="secondary" style={{ padding: "8px" }}>
              {reviewerName}
            </Typography.Text>
          </Typography.Text>
          {/* edit & delete buttons, that we have to use after login functionality */}
          <Row>
            <Typography.Text strong type="primary" style={{ marginRight: "6px" }}>
              {rating}
            </Typography.Text>
            <Image src={star} width={20} height={20} style={{ marginRight: "6px" }} />
            <div style={{ justifyContent: "flex-end" }}>
            <Button
              type="primary"
              style={{ marginRight: "6px" }}
              icon={<EditOutlined />}
            />
            <Button
              danger
              type="primary"
              icon={<DeleteOutlined />}
            />
          </div>
          </Row>
        </div>
        <Typography.Text type="secondary">
          Reviewed on {unixToDate(createdDate)}
        </Typography.Text>
        <Typography.Text style={{ position: "relative", top: "10px" }} strong>
          {title}
        </Typography.Text>
        <Typography.Text style={{ position: "relative", top: "6px" }}>
          {decodeURIComponentText(description, readmore)}
        </Typography.Text>
        {description?.length > 100 ? (
          readmore ? (
            <Button
              block
              className="read-btn"
              onClick={() => {
                if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                  window.location.href = loginUrl;
                } else {
                  props.handleRead();
                }
              }}
            >
              <UpOutlined /> Hide full review
            </Button>
          ) : (
            <Button
              block
              className="read-btn"
              onClick={() => {
                if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                  window.location.href = loginUrl;
                } else {
                  props.handleRead();
                }
              }}
            >
              {" "}
              <DownOutlined /> See full review
            </Button>
          )
        ) : (
          ""
        )}
      </Space>
    </>
  );
};

export default ReviewCard;
