import React, { useState } from "react";
import {
  Form,
  Input,
  Modal,
  Select } 
from "antd";

const { Option } = Select;

const CreateModal = ({
  isCreateModalOpen,
  toggleCreateModal,
  dispatch,
  actions,
  isCreateSubmitting,
  debouncedSearchTerm
}) => {

  const [name, setname] = useState();
  const [description, setdescription] = useState();
  const [createdAt, setcreatedAt] = useState();

  const handleFormSubmit = async () => {
    const body = {
      categoryArgs: {
            name,
            description,
            createdAt,
      },
      isPublic: false
    };

    let isDone = await actions.createCategory(dispatch, body); 

    if (isDone) {
      actions.fetchCategories(dispatch, 10, 0, debouncedSearchTerm);
      toggleCreateModal(false);
    }
  }

  const isDisabled = (   !name ||   !description ||   !createdAt );

  const primaryAction = {
    content: "Create Category",
    disabled: isDisabled,
    onAction: handleFormSubmit,
    loading: isCreateSubmitting
  };

  return (
    <Modal
      open={isCreateModalOpen}
      title={"Create Category"}
      onOk={primaryAction.onAction}
      okType={"primary"}
      okText={"Create Category"}
      okButtonProps={{ disabled: primaryAction.disabled }}
      onCancel={() => toggleCreateModal(!isCreateModalOpen)}
      confirmLoading={primaryAction.loading}
    >
      <Form labelCol={{ span: 8 }}>
        <Form.Item 
          label="name"
          name="name"
          rules={[{ required: true, message: 'Please input name.' }]}
        >
          <Input
            label="name"
            onChange={ (e) => setname(e.target.value) }
          />
        </Form.Item>
        <Form.Item 
          label="description"
          name="description"
          rules={[{ required: true, message: 'Please input description.' }]}
        >
          <Input
            label="description"
            onChange={ (e) => setdescription(e.target.value) }
          />
        </Form.Item>
        <Form.Item 
          label="createdAt"
          name="createdAt"
          rules={[{ required: true, message: 'Please input createdAt.' }]}
        >
          <Input
            label="createdAt"
            onChange={ (e) => setcreatedAt(e.target.value) }
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default CreateModal;
