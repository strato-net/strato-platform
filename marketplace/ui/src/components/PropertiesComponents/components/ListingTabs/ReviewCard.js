import React, { useEffect, useState } from "react";
import { Button, Typography, Space, Avatar, Form, Col } from "antd";
import { UserOutlined, DownOutlined, UpOutlined } from "@ant-design/icons";
import { decodeURIComponentText } from "../../helpers/utils";

const ReviewCard = (props) => {
  const { review: { name, title, date, description, readmore }, index } = props

  return (
    <>
      <Space
        direction="vertical"
        size="small"
        style={{ marginTop: "30px", width: '400px' }}
        key={index}
      >
        <div style={{ display: "flex", justifyContent: "space-between" }}>
          <Typography.Text type="secondary">
            <Avatar size="small" icon={<UserOutlined />} />
            <Typography.Text type="secondary" style={{ padding: "8px" }}>
              {name}
            </Typography.Text>
          </Typography.Text>
          {/* edit & delete buttons, that we have to use after login functionality */}
          {/* <div style={{ justifyContent: "flex-end" }}>
                <Button
                  type="primary"
                  style={{ marginRight: "10px" }}
                  icon={<EditOutlined />}
                />
                <Button
                  danger
                  type="primary"
                  icon={<DeleteOutlined />}
                />
              </div> */}
        </div>
        <Typography.Text type="secondary">Reviewed on {date}</Typography.Text>
        <Typography.Text style={{ position: "relative", top: '10px' }} strong>{title}</Typography.Text>
        <Typography.Text>
          {readmore
            ? decodeURIComponentText(description)
            : decodeURIComponentText(description).slice(0, 100)}
        </Typography.Text>
        {
          description?.length > 100 ?
            readmore
              ? <Button block className="read-btn" onClick={() => { props.handleRead() }}><UpOutlined /> Hide full review</Button>
              : <Button block className="read-btn" onClick={() => { props.handleRead() }}> <DownOutlined /> See full review</Button>
            : ''}
      </Space>

    </>
  )
}

export default ReviewCard