import React from 'react'
import { Modal, Divider, Typography } from 'antd'
import TagManager from "react-gtm-module";

function DeleteReviewModal({ open, handleDeleteReview, isReviewDeleting, handleCancel}) {

  const primaryAction = {
    content: 'Delete Review - Confirmation',
    disabled: false,
    onAction: () => {
      handleDeleteReview()
      TagManager.dataLayer({
        dataLayer: {
          event: "PROPERTIES_DELETE_REVIEW",
        },
      })
    },
    loading: isReviewDeleting,
  };

  return (
    <>
      <Modal
        open={open}
        title={primaryAction.content}
        onOk={primaryAction.onAction}
        okType={"primary"}
        okText={"Submit"}
        okButtonProps={{ disabled: primaryAction.disabled }}
        cancelButtonProps={{ disabled: primaryAction.disabled }}
        onCancel={handleCancel}
        confirmLoading={primaryAction.loading}
        width={400}
      >
        <Divider />
        <Typography.Paragraph>Are you sure you want to delete this review?</Typography.Paragraph>
        <Divider />
      </Modal>
    </>
  )
}

export default DeleteReviewModal