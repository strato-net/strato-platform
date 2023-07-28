import React from 'react'
import { Modal, Divider, Typography } from 'antd'

function PropertyCreateConfirmModal({isCreateConfirmModalOpen, toggleCreateConfirmModal}) {

  const primaryAction = {
    content: "Create a Property Listing - Confirmation",
    disabled: false,
    // onAction: handleFormSubmit,
    // loading: isCreateSubmitting
  };

  return (
      <Modal
        open={isCreateConfirmModalOpen}
        title={primaryAction.content}
        onOk={primaryAction.onAction}
        okType={"primary"}
        okText={"Submit"}
        okButtonProps={{ disabled: primaryAction.disabled }}
        onCancel={() => toggleCreateConfirmModal(!isCreateConfirmModalOpen)}
        // confirmLoading={primaryAction.loading}
        width={400}
      >
        <Divider />
        <Typography.Paragraph>Would you like to proceed with creating this project and issuing credits on its behalf?</Typography.Paragraph>
        <Typography.Paragraph>Minting may take a few minutes.</Typography.Paragraph>
        <Divider />
        </Modal>
    )
}

export default PropertyCreateConfirmModal