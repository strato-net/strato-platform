import React, { useEffect, useState } from "react";
import { Button, Typography, Space, Avatar, Form, Col } from "antd";
import { UserOutlined, DownOutlined, UpOutlined } from "@ant-design/icons";

import WriteReviewModal from "../review/WriteReviewModal";
import ReviewCard from "./ReviewCard";

const ReviewTab = (props) => {
  const { reviews } = props

  const [open, setOpen] = useState(false);
  const [reviewsList, setReviewList] = useState(reviews)
  const [form] = Form.useForm();

  useEffect(() => {

  }, []);

  const handleSubmit = async () => {

  };

  const handleCancel = () => {
    setOpen(false);
  };

  const handleRead = (index) => {
    let list = [...reviewsList]
    list[index].readmore = !list[index].readmore
    setReviewList(list)
  }

  return (
    <Col style={{ width: '400px' }}>
      <Button block onClick={() => setOpen(!open)}>
        Write a Review
      </Button>
      <WriteReviewModal
        open={open}
        form={form}
        isReviewSubmitting={false}
        handleCancel={handleCancel}
        handleSubmit={handleSubmit}
      />
      <div style={{ margin: "10px" }}>
        {reviews?.map((review, index) => {
          return <ReviewCard
            review={review}
            index={index}
            handleRead={() => { handleRead(index) }} />
        })}
      </div>
    </Col>
  );
};

export default ReviewTab;
