import React from 'react'
import { Modal, Divider, Typography } from 'antd'
import TagManager from "react-gtm-module";

function PropertyCreateConfirmModal({ isEdit, isCreateConfirmModalOpen, toggleCreateConfirmModal, handleSubmitCreateProperty, isCreatePropertySubmitting }) {

  const primaryAction = {
    content: `${isEdit ? "Update Property" : "Create a Property Listing"} - Confirmation`,
    disabled: false,
    onAction: () => {
      handleSubmitCreateProperty()
      TagManager.dataLayer({
        dataLayer: {
          event: "PROPERTIES_SUBMIT_CREATE_PROPERTY",
        },
      })
    }, loading: isCreatePropertySubmitting
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
        <Typography.Paragraph>Would you like to proceed with {isEdit ? "updating this property" : "creating this property listing"}?</Typography.Paragraph>
        <Divider />
      </Modal>
    </>
  )
}

export default PropertyCreateConfirmModal