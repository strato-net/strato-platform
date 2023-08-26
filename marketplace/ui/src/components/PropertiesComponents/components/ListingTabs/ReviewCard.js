import React, { useEffect, useState } from "react";
import { Button, Typography, Space, Avatar, Form, Row, Image, notification } from "antd";
import { UserOutlined, DownOutlined, UpOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import { useAuthenticateState } from "../../../../contexts/authentication";
import { decodeURIComponentText, unixToDate } from "../../helpers/utils";
import star from "../../assets/icons/star.svg";
import EditReviewModal from "./EditReviewModal";
import {
  usePropertiesDispatch,
  usePropertiesState,
} from "../../../../contexts/propertyContext";
import { actions } from "../../../../contexts/propertyContext/actions";

const ReviewCard = (props) => {
  const {
    review: { reviewerName, title, createdDate, rating, description, address, readmore },
    index
  } = props;
  const decodedDescription = decodeURIComponentText(description, readmore)

  const [form] = Form.useForm();
  const [api, contextHolder] = notification.useNotification();

  const [open, setOpen] = useState(false);
  const [reviewData, setReviewData] = useState({})


  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
  const { message, success, isReviewUpdating } = usePropertiesState();
  const dispatch = usePropertiesDispatch();

  const handleCancel = () => {
    setOpen(false);
  };

  const handleSubmitUpdate = async () => {
    const encodedDescription = encodeURIComponent(form.getFieldValue("description"));
    const formBody = {
      ...form.getFieldsValue(),
      description: encodedDescription,
      address: address,
    }
    console.log('form', formBody)
    await actions.updateReview(dispatch, formBody);
  }

  const openToast = (placement) => {

    if (success) {
      api.success({
        message: message,
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: message,
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 2,
      });
    }
  };

  useEffect(() => {
    form.setFieldsValue({
      title: title,
      rating: rating,
      description: decodeURIComponent(description.replace(/%0A/g, '\n')),
    });
  }, []);

  return (
    <>
      {message && openToast("bottom")}
      {contextHolder}
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
          <Row>
            <Typography.Text strong type="primary" style={{ marginRight: "6px" }}>
              {rating}
            </Typography.Text>
            <Image src={star} width={20} height={20} preview={false} style={{ marginRight: "6px" }} />
            {/* edit & delete buttons, that we have to use after login functionality */}
            <div style={{ justifyContent: "flex-end" }}>
              <Button
                type="primary"
                style={{ marginRight: "6px" }}
                icon={<EditOutlined />}
                onClick={() => {
                  setOpen(!open)
                }}
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
          {decodedDescription}
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
      <EditReviewModal
        open={open}
        title={title}
        rating={rating}
        description={description}
        isReviewUpdating={isReviewUpdating}
        form={form}
        reviewData={reviewData}
        setReviewData={setReviewData}
        handleCancel={handleCancel}
        handleSubmitUpdate={handleSubmitUpdate}
      />
    </>
  );
};

export default ReviewCard;
