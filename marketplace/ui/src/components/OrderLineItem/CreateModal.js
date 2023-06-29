import React, { useState } from "react";
import {
  Form,
  Input,
  InputNumber,
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

  const [orderId, setorderId] = useState();
  const [inventoryId, setinventoryId] = useState();
  const [productId, setproductId] = useState();
  const [quantity, setquantity] = useState();
  const [pricePerUnit, setpricePerUnit] = useState();
  const [createdAt, setcreatedAt] = useState();

  const handleFormSubmit = async () => {
    const body = {
      orderLineItemArgs: {
            orderId,
            inventoryId,
            productId,
            quantity,
            pricePerUnit,
            createdAt,
      },
      isPublic: false
    };

    let isDone = await actions.createOrderLineItem(dispatch, body); 

    if (isDone) {
      actions.fetchOrderLineItem(dispatch, 10, 0, debouncedSearchTerm);
      toggleCreateModal(false);
    }
  }

  const isDisabled = (   !orderId ||   !inventoryId ||   !productId ||   !quantity ||   !pricePerUnit ||   !createdAt );

  const primaryAction = {
    content: "Create OrderLineItem",
    disabled: isDisabled,
    onAction: handleFormSubmit,
    loading: isCreateSubmitting
  };

  return (
    <Modal
      open={isCreateModalOpen}
      title={"Create OrderLineItem"}
      onOk={primaryAction.onAction}
      okType={"primary"}
      okText={"Create OrderLineItem"}
      okButtonProps={{ disabled: primaryAction.disabled }}
      onCancel={() => toggleCreateModal(!isCreateModalOpen)}
      confirmLoading={primaryAction.loading}
    >
      <Form labelCol={{ span: 8 }}>
        <Form.Item 
          label="orderId"
          name="orderId"
          rules={[{ required: true, message: 'Please input orderId.' }]}
        >
          <Input
            label="orderId"
            onChange={ (e) => setorderId(e.target.value) }
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
          label="quantity"
          name="quantity"
          rules={[{ required: true, message: 'Please input quantity.' }]}
        >
          <InputNumber
            label="quantity"
            onChange={ (e) => setquantity(e) }
          />
        </Form.Item>
        <Form.Item
          label="pricePerUnit"
          name="pricePerUnit"
          rules={[{ required: true, message: 'Please input pricePerUnit.' }]}
        >
          <InputNumber
            label="pricePerUnit"
            onChange={ (e) => setpricePerUnit(e) }
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
