import React, { useEffect, useState } from "react";
import { Button, Typography, Space, Avatar, Form, Col } from "antd";
import { UserOutlined, DownOutlined, UpOutlined } from "@ant-design/icons";

import WriteReviewModal from "../review/WriteReviewModal";
import ReviewCard from "./ReviewCard";

const ReviewTab = () => {
  const [open, setOpen] = useState(false);
  const [reviewsList, setReviewList] = useState([{
    name: 'Tanuj',
    date: "12 july, 2023",
    title: "review 1",
    comments: 'comment 1',
    readmore: false
  },
  {
    name: 'Rishi',
    date: "14 july, 2023",
    title: "review 2",
    comments: 'comment 2',
    readmore: false
  }, {
    name: 'Rahul',
    date: "16 july, 2023",
    title: "review 3",
    comments: 'comment 3',
    readmore: false
  }
  ])
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
        {reviewsList?.map((review, index) => {
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
