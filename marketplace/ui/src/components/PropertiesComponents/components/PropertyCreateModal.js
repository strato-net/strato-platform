import React from 'react'
import { Modal, Form, Divider, Input } from 'antd'

function PropertyCreateModal({ isCreateModalOpen, toggleCreateModal, modalView, setModalView, isCreateConfirmModalOpen, toggleCreateConfirmModal }) {
  const [name, setname] = React.useState('')

  const handleModalToggle = () => {
    setModalView(!modalView)
  }

  const showConfirmationModal = () => {
    toggleCreateConfirmModal(!isCreateConfirmModalOpen)
  }

  const primaryAction = {
    content: "Create a Property Listing",
    // disabled: modalCreateView ? isDisabledCreateView : isDisabledIssuanceView,
    onToggle: handleModalToggle,
    onConfirm: showConfirmationModal,
  };

  return (
    <Modal
      open={isCreateModalOpen}
      title={primaryAction.content}
      onOk={modalView ? primaryAction.onToggle : primaryAction.onConfirm}
      okType={"primary"}
      okText={modalView ? "Next" : "Submit"}
      // okButtonProps={{ disabled: primaryAction.disabled }}
      onCancel={() => {toggleCreateModal(!isCreateModalOpen)
        setModalView(!modalView)}}
      // confirmLoading={primaryAction.loading}
      width={850}
    >
      <Divider />
      {modalView ? (
      <Form labelCol={{ span: 8 }} labelAlign='left'>
      <Form.Item
              label="Project Name*"
              name="name"
              rules={[{ message: 'Please input project name.' }]}
            >
              <Input
                label="name"
                defaultValue={name}
                maxLength={100}
                showCount
                onChange={(e) => setname(e.target.value)}
              />
            </Form.Item>
      </Form>)
      : 
      (<div>Form 2</div>)
      }
    </Modal>
  )
}

export default PropertyCreateModal