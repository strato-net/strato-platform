import React, { useState } from "react";
import {
  Form,
  Input,
  Modal } 
from "antd";

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
  const [category, setcategory] = useState();
  const [createdAt, setcreatedAt] = useState();

  const handleFormSubmit = async () => {
    const body = {
      subCategoryArgs: {
            name,
            description,
            category,
            createdAt,
      },
      isPublic: false
    };

    let isDone = await actions.createSubCategory(dispatch, body); 

    if (isDone) {
      actions.fetchSubCategory(dispatch, 10, 0, debouncedSearchTerm);
      toggleCreateModal(false);
    }
  }

  const isDisabled = (   !name ||   !description ||   !category ||   !createdAt );

  const primaryAction = {
    content: "Create SubCategory",
    disabled: isDisabled,
    onAction: handleFormSubmit,
    loading: isCreateSubmitting
  };

  return (
    <Modal
      open={isCreateModalOpen}
      title={"Create SubCategory"}
      onOk={primaryAction.onAction}
      okType={"primary"}
      okText={"Create SubCategory"}
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
          label="category"
          name="category"
          rules={[{ required: true, message: 'Please input category.' }]}
        >
          <Input
            label="category"
            onChange={ (e) => setcategory(e.target.value) }
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
