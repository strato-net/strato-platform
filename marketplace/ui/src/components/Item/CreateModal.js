import React, { useState } from "react";
import {
  DatePicker,
  Form,
  Input,
  InputNumber,
  Modal,
  Radio,
  Select } 
from "antd";
import dayjs from "dayjs";

const { Option } = Select;

const CreateModal = ({
  isCreateModalOpen,
  toggleCreateModal,
  dispatch,
  actions,
  isCreateSubmitting,
  debouncedSearchTerm
}) => {

  const [productId, setproductId] = useState();
  const [inventoryId, setinventoryId] = useState();
  const [serialNumber, setserialNumber] = useState();
  const [status, setstatus] = useState();
  const [comment, setcomment] = useState();
  const [createdAt, setcreatedAt] = useState();

  const handleFormSubmit = async () => {
    const body = {
      itemArgs: {
            productId,
            inventoryId,
            serialNumber,
            status,
            comment,
            createdAt,
      },
      isPublic: false
    };

    let isDone = await actions.createItem(dispatch, body); 

    if (isDone) {
      actions.fetchItem(dispatch, 10, 0, debouncedSearchTerm);
      toggleCreateModal(false);
    }
  }

  const isDisabled = (   !productId ||   !inventoryId ||   !serialNumber ||   !status ||   !comment ||   !createdAt );

  const primaryAction = {
    content: "Create Item",
    disabled: isDisabled,
    onAction: handleFormSubmit,
    loading: isCreateSubmitting
  };

  return (
    <Modal
      open={isCreateModalOpen}
      title={"Create Item"}
      onOk={primaryAction.onAction}
      okType={"primary"}
      okText={"Create Item"}
      okButtonProps={{ disabled: primaryAction.disabled }}
      onCancel={() => toggleCreateModal(!isCreateModalOpen)}
      confirmLoading={primaryAction.loading}
    >
      <Form labelCol={{ span: 8 }}>
        <Form.Item 
          label="productId"
          name="productId"
          rules={[{ required: true, message: 'Please input productId.' }]}
        >
          <Input
            label="productId"
            onChange={ (e) => setproductId(e.target.value) }
          />
        </Form.Item>
        <Form.Item 
          label="inventoryId"
          name="inventoryId"
          rules={[{ required: true, message: 'Please input inventoryId.' }]}
        >
          <Input
            label="inventoryId"
            onChange={ (e) => setinventoryId(e.target.value) }
          />
        </Form.Item>
        <Form.Item 
          label="serialNumber"
          name="serialNumber"
          rules={[{ required: true, message: 'Please input serialNumber.' }]}
        >
          <Input
            label="serialNumber"
            onChange={ (e) => setserialNumber(e.target.value) }
          />
        </Form.Item>
        <Form.Item 
          label="status"
          name="status"
          rules={[{ required: true, message: 'Please input status.' }]}
        >
          <Input
            label="status"
            onChange={ (e) => setstatus(e.target.value) }
          />
        </Form.Item>
        <Form.Item 
          label="comment"
          name="comment"
          rules={[{ required: true, message: 'Please input comment.' }]}
        >
          <Input
            label="comment"
            onChange={ (e) => setcomment(e.target.value) }
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
