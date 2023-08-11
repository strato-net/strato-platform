import React from 'react'
import { Modal, Divider, Typography } from 'antd'

function PropertyCreateConfirmModal({ isCreateConfirmModalOpen, toggleCreateConfirmModal, handleSubmitCreateProperty, isCreatePropertySubmitting }) {

  const primaryAction = {
    content: "Create a Property Listing - Confirmation",
    disabled: false,
    onAction: handleSubmitCreateProperty,
    loading: isCreatePropertySubmitting
  };

  return (
    <>
      <Modal
        open={isCreateConfirmModalOpen}
        title={primaryAction.content}
        onOk={primaryAction.onAction}
        okType={"primary"}
        okText={"Submit"}
        okButtonProps={{ disabled: isCreatePropertySubmitting }}
        cancelButtonProps={{ disabled: isCreatePropertySubmitting }}
        onCancel={() => toggleCreateConfirmModal(!isCreateConfirmModalOpen)}
        confirmLoading={primaryAction.loading}
        width={400}
      >
        <Divider />
        <Typography.Paragraph>Would you like to proceed with creating this property listing?</Typography.Paragraph>
        <Divider />
      </Modal>
    </>
  )
}

export default PropertyCreateConfirmModal