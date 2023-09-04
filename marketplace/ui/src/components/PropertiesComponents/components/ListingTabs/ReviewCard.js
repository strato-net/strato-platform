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
import DeleteReviewModal from "./DeleteReviewModal";

const ReviewCard = (props) => {
  const {
    review: { reviewerName, title, createdDate, rating, description, address, reviewerAddress, readmore },
    index, id, userAddress
  } = props;
  const decodedDescription = decodeURIComponentText(description, readmore)

  const [form] = Form.useForm();
  const [api, contextHolder] = notification.useNotification();

  const [open, setOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [reviewData, setReviewData] = useState({})


  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
  const { message, success, isReviewUpdating, isReviewDeleting } = usePropertiesState();
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

    const result = await actions.updateReview(dispatch, formBody);
    if (result) {
      setOpen(!open)
      actions.fetchPropertyDetails(dispatch, id);
    }
  };

  const handleDeleteReview = async () => {
    const result = await actions.deleteReview(dispatch, { reviewAddress: address });
    if (result) {
      setOpen(!open)
      actions.fetchPropertyDetails(dispatch, id);
    }
  };

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
        className="mt-8"
        style={{ width: "400px" }}
        key={index}
      >
        <div className="flex justify-between">
          <Typography.Text type="secondary">
            <Avatar size="small" icon={<UserOutlined />} />
            <Typography.Text type="secondary" className="p-2" >
              {reviewerName}
            </Typography.Text>
          </Typography.Text>
          <Row className="flex items-center">
            {userAddress === reviewerAddress &&
              <div className="justify-end">
                <Button
                  type="primary"
                  className="mr-2"
                  icon={<EditOutlined />}
                  onClick={() => {
                    setOpen(!open)
                  }}
                />
                <Button
                  danger
                  type="primary"
                  className="mr-2"
                  icon={<DeleteOutlined />}
                  onClick={() => {
                    setDeleteModalOpen(!deleteModalOpen)
                  }}
                />
              </div>
            }
            <Typography.Text strong type="primary" className="mr-2" >
              {rating}
            </Typography.Text>
            <Image src={star} width={20} height={20} preview={false} />
          </Row>
        </div>
        <Typography.Text type="secondary">
          Reviewed on {unixToDate(createdDate)}
        </Typography.Text>
        <Typography.Text className="relative top-2.5" strong>
          {title}
        </Typography.Text>
        <Typography.Text className="relative top-1.5" >
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
      <DeleteReviewModal
        open={deleteModalOpen}
        handleDeleteReview={handleDeleteReview}
        isReviewDeleting={isReviewDeleting}
        handleCancel={() => setDeleteModalOpen(false)}
      />
    </>
  );
};

export default ReviewCard;
