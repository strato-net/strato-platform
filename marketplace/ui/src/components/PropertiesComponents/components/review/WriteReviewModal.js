import React, { useState } from "react";
import { Button, Modal, Col, Row, Input, Form, Rate } from "antd";
import TagManager from "react-gtm-module";

const { TextArea } = Input;

const WriteReviewModal = (props) => {
  const [reviewData, setReviewData] = useState({})
  const { open, handleCancel, isReviewSubmitting, handleSubmit, form } = props;

  const handleChange = (key, value) => {
    let data = { ...reviewData }
    data[key] = value;
    setReviewData(data)
  }

  return (
    <Modal
      open={open}
      title="Write a Review"
      onCancel={() => handleCancel()}
      footer={[
        <Button
          key="back"
          onClick={() => handleCancel()}
          disabled={isReviewSubmitting}
        >
          Cancel
        </Button>,
        <Button
          key="submit"
          type="primary"
          htmlType="submit"
          loading={isReviewSubmitting}
          disabled={isReviewSubmitting}
          onClick={() => {
            TagManager.dataLayer({
              dataLayer: {
                event: 'PROPERTIES_REVIEW_SUBMITTED',
              },
            })
            handleSubmit()
          }}
        >
          Submit
        </Button>,
      ]}
    >
      <Form name="basic" form={form} layout="vertical">
        <Form.Item
          label="Title"
          name="title"
          rules={[
            {
              required: true,
              message: "Please input a title!",
            },
          ]}
        >
          <Input onChange={(e) => { handleChange("title", e.target.value) }} />
        </Form.Item>
        <Form.Item
          label="How would you rate the property?"
          name="rating"
          className="my-4"
          rules={[
            {
              required: true,
              message: "Please provide a rating!",
            },
          ]}
        >
          <Rate onChange={(e) => { handleChange("rating", e.target.value) }} />
        </Form.Item>
        <Form.Item
          label="What do you think of the property?"
          name="description"
          rules={[
            {
              required: true,
              message: "Please provide comments!",
            },
          ]}
        >
          <TextArea rows={4} style={{resize: 'none'}} onChange={(e) => { handleChange("description", e.target.value) }} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default WriteReviewModal;
