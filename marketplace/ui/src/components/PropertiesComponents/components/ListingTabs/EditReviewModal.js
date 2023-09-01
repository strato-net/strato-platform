import React from "react";
import { Button, Modal, Form, Input, Rate } from "antd";
import TagManager from "react-gtm-module";

const { TextArea } = Input;

const EditReviewModal = (props) => {
  const { open, title, rating, description, handleCancel, isReviewUpdating, reviewData, setReviewData, handleSubmitUpdate, form } = props;
  const disabledSubmitReview =
    !form.getFieldValue("title") ||
    !form.getFieldValue("rating") ||
    !form.getFieldValue("description");


  const handleChange = (key, value) => {
    let data = { ...reviewData }
    data[key] = value;
    setReviewData(data)
  }

  return (
      <Modal
        open={open}
        title="Edit your review"
        onCancel={() => handleCancel()}
        footer={[
          <Button
            key="back"
            onClick={() => handleCancel()}
            disabled={isReviewUpdating}
          >
            Cancel
          </Button>,
          <Button
            key="submit"
            type="primary"
            htmlType="submit"
            loading={isReviewUpdating}
            disabled={disabledSubmitReview}
            onClick={() => {
              TagManager.dataLayer({
                dataLayer: {
                  event: 'PROPERTIES_EDIT_REVIEW_SUBMITTED',
                },
              })
              handleSubmitUpdate()
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
            <Input onChange={(e) => { handleChange("title", e.target.value) }}
              value={title}
              defaultValue={title} />
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
            <Rate onChange={(e) => { handleChange("rating", e.target.value) }}
              value={rating}
              defaultValue={rating} />
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
            <TextArea rows={4} style={{ resize: 'none' }} onChange={(e) => { handleChange("description", e.target.value) }}
              value={decodeURIComponent(description.replace(/%0A/g, '\n'))}
              defaultValue={decodeURIComponent(description.replace(/%0A/g, '\n'))}
            />
          </Form.Item>
        </Form>
      </Modal>
  );
};

export default EditReviewModal;
