import React, { useEffect, useState } from "react";
import { Button, Typography, Space, Avatar, Form, Col, notification } from "antd";
import { UserOutlined, DownOutlined, UpOutlined } from "@ant-design/icons";
import { actions } from "../../../../contexts/propertyContext/actions";
import {
  usePropertiesDispatch,
  usePropertiesState,
} from "../../../../contexts/propertyContext";
import { useAuthenticateState } from "../../../../contexts/authentication";
import TagManager from "react-gtm-module";
import WriteReviewModal from "./WriteReviewModal";
import ReviewCard from "./ReviewCard";

const ReviewTab = (props) => {
  const { reviews } = props
  const dispatch = usePropertiesDispatch();

  const [open, setOpen] = useState(false);
  const [reviewsList, setReviewList] = useState(reviews)
  const [form] = Form.useForm();

  const [api, contextHolder] = notification.useNotification();

  let { hasChecked, isAuthenticated, loginUrl, user } = useAuthenticateState();
  const { message, success, isReviewAdding } = usePropertiesState();
  useEffect(() => {
    const listOfReviews = []
    reviews?.forEach((review) => {
      listOfReviews.push({ ...review, readmore: false })
    })
    setReviewList(listOfReviews)
  }, [reviews]);

  const handleSubmit = async () => {
    const encodedDescription = encodeURIComponent(form.getFieldValue("description"));

    const reviewForm = {
      ...form.getFieldsValue(),
      productId: props.productId,
      propertyId: props.propertyId,
      reviewerName: user.commonName,
      reviewerAddress: user.userAddress,
      description: encodedDescription,
    };
    const response = await actions.createReview(dispatch, reviewForm);
    if (response) {
      setOpen(false)
      actions.fetchPropertyDetails(dispatch, props.propertyId);
    }
  };

  const handleCancel = () => {
    setOpen(false);
  };

  const handleRead = (index) => {
    let list = [...reviewsList]
    list[index].readmore = !list[index].readmore
    setReviewList(list)
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

  return (
    <>
      {contextHolder}
      {message && openToast("bottom")}
      <Col style={{ width: '400px' }}>
        <Button block type="primary" onClick={() => {
          TagManager.dataLayer({
            dataLayer: {
              event: 'PROPERTIES_OPEN_WRITE_REVIEW',
            },
          })
          if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
            window.location.href = loginUrl;
          } else {
            setOpen(!open)
          }
        }}>
          Write a Review
        </Button>
        <WriteReviewModal
          open={open}
          form={form}
          isReviewSubmitting={isReviewAdding}
          handleCancel={handleCancel}
          handleSubmit={handleSubmit}
        />
        <Col className="mt-2.5">
          {reviewsList?.map((review, index) => {
            return <ReviewCard
              review={review}
              index={index}
              setOpen={setOpen}
              open={open}
              handleRead={() => { handleRead(index) }} 
              userAddress={user.userAddress}
              id={props.propertyId} />
          })}
        </Col>
      </Col>
    </>
  );
};

export default ReviewTab;
