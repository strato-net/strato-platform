import React, { useState } from "react";
import { Button, Modal, Col, Row, Input, Form } from "antd";
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
          onClick={() => handleSubmit()}
        >
          Submit
        </Button>,
      ]}
    >
      <Form name="basic" form={form} layout="vertical">
        <Row gutter={24}>
          <Col span={12}>
            <Form.Item
              label="First Name"
              name="firstName"
              rules={[
                {
                  required: true,
                  message: "Please input your First Name!",
                },
              ]}
            >
              <Input onChange={(e) => { handleChange("firstName", e.target.value) }} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              label="Last Name"
              name="lastName"
              rules={[
                {
                  required: true,
                  message: "Please input your Last Name!",
                },
              ]}
            >
              <Input onChange={(e) => { handleChange("lastName", e.target.value) }} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item
          label="Email"
          name="email"
          rules={[
            {
              required: true,
              message: "Please input your email!",
            },
            {
              type: "email",
              message: "Please enter a valid email address!",
            },
          ]}
        >
          <Input onChange={(e) => { handleChange("email", e.target.value) }} />
        </Form.Item>
        <Form.Item
          label="What do you think of the property?"
          name="comments"
          rules={[
            {
              required: true,
              message: "Please provide comments!",
            },
          ]}
        >
          <TextArea rows={4} onChange={(e) => { handleChange("comments", e.target.value) }} />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default WriteReviewModal;
