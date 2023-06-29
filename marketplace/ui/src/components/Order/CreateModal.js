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

  const [orderId, setorderId] = useState();
  const [buyerOrganization, setbuyerOrganization] = useState();
  const [sellerOrganization, setsellerOrganization] = useState();
  const [orderDate, setorderDate] = useState();
  const [orderTotal, setorderTotal] = useState();
  const [orderShippingCharges, setorderShippingCharges] = useState();
  const [status, setstatus] = useState();
  const [paymentDate, setpaymentDate] = useState();
  const [paidBy, setpaidBy] = useState();
  const [amountPaid, setamountPaid] = useState();
  const [fullfilmentDate, setfullfilmentDate] = useState();
  const [comments, setcomments] = useState();
  const [createdAt, setcreatedAt] = useState();

  const handleFormSubmit = async () => {
    const body = {
      orderArgs: {
            orderId,
            buyerOrganization,
            sellerOrganization,
            orderDate,
            orderTotal,
            orderShippingCharges,
            status,
            paymentDate,
            paidBy,
            amountPaid,
            fullfilmentDate,
            comments,
            createdAt,
      },
      isPublic: false
    };

    let isDone = await actions.createOrder(dispatch, body); 

    if (isDone) {
      actions.fetchOrder(dispatch, 10, 0, debouncedSearchTerm);
      toggleCreateModal(false);
    }
  }

  const isDisabled = (   !orderId ||   !buyerOrganization ||   !sellerOrganization ||   !orderDate ||   !orderTotal ||   !orderShippingCharges ||   !status ||   !paymentDate ||   !paidBy ||   !amountPaid ||   !fullfilmentDate ||   !comments ||   !createdAt );

  const primaryAction = {
    content: "Create Order",
    disabled: isDisabled,
    onAction: handleFormSubmit,
    loading: isCreateSubmitting
  };

  return (
    <Modal
      open={isCreateModalOpen}
      title={"Create Order"}
      onOk={primaryAction.onAction}
      okType={"primary"}
      okText={"Create Order"}
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
          label="buyerOrganization"
          name="buyerOrganization"
          rules={[{ required: true, message: 'Please input buyerOrganization.' }]}
        >
          <Input
            label="buyerOrganization"
            onChange={ (e) => setbuyerOrganization(e.target.value) }
          />
        </Form.Item>
        <Form.Item 
          label="sellerOrganization"
          name="sellerOrganization"
          rules={[{ required: true, message: 'Please input sellerOrganization.' }]}
        >
          <Input
            label="sellerOrganization"
            onChange={ (e) => setsellerOrganization(e.target.value) }
          />
        </Form.Item>
        <Form.Item 
          label="orderDate"
          name="orderDate"
          rules={[{ required: true, message: 'Please input orderDate.' }]}
        >
          <Input
            label="orderDate"
            onChange={ (e) => setorderDate(e.target.value) }
          />
        </Form.Item>
        <Form.Item
          label="orderTotal"
          name="orderTotal"
          rules={[{ required: true, message: 'Please input orderTotal.' }]}
        >
          <InputNumber
            label="orderTotal"
            onChange={ (e) => setorderTotal(e) }
          />
        </Form.Item>
        <Form.Item
          label="orderShippingCharges"
          name="orderShippingCharges"
          rules={[{ required: true, message: 'Please input orderShippingCharges.' }]}
        >
          <InputNumber
            label="orderShippingCharges"
            onChange={ (e) => setorderShippingCharges(e) }
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
          label="paymentDate"
          name="paymentDate"
          rules={[{ required: true, message: 'Please input paymentDate.' }]}
        >
          <Input
            label="paymentDate"
            onChange={ (e) => setpaymentDate(e.target.value) }
          />
        </Form.Item>
        <Form.Item 
          label="paidBy"
          name="paidBy"
          rules={[{ required: true, message: 'Please input paidBy.' }]}
        >
          <Input
            label="paidBy"
            onChange={ (e) => setpaidBy(e.target.value) }
          />
        </Form.Item>
        <Form.Item
          label="amountPaid"
          name="amountPaid"
          rules={[{ required: true, message: 'Please input amountPaid.' }]}
        >
          <InputNumber
            label="amountPaid"
            onChange={ (e) => setamountPaid(e) }
          />
        </Form.Item>
        <Form.Item 
          label="fullfilmentDate"
          name="fullfilmentDate"
          rules={[{ required: true, message: 'Please input fullfilmentDate.' }]}
        >
          <Input
            label="fullfilmentDate"
            onChange={ (e) => setfullfilmentDate(e.target.value) }
          />
        </Form.Item>
        <Form.Item 
          label="comments"
          name="comments"
          rules={[{ required: true, message: 'Please input comments.' }]}
        >
          <Input
            label="comments"
            onChange={ (e) => setcomments(e.target.value) }
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
