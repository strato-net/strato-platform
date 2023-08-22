import React, { useState } from "react";
import { Form, Modal, InputNumber, Button, Spin, Table } from "antd";

const ListNowModal = ({
  open,
  handleCancel,
  user,
  formik,
  getIn,
  isCreateMembershipSubmitting,
}) => {
  const seller = user.user.organization;
  const membership = formik.values.name;

  const columns = [
    {
      title: "Seller",
      dataIndex: "seller",
      key: "seller",
    },
    {
      title: "Membership",
      dataIndex: "membership",
      key: "membership",
    },
    {
      title: "Quantity",
      dataIndex: "quantity",
      key: "quantity",
    },
    {
      title: "Price",
      dataIndex: "price",
      key: "price",
    },
  ];

  const data = [
    {
      key: "1",
      seller: seller,
      membership: membership,
      quantity: (
        <>
          <InputNumber
            id="quantity"
            name="quantity"
            min={0}
            value={formik.values.quantity}
            onChange={(value) => {
              formik.setFieldValue("quantity", value);
            }}
          />
          {getIn(formik.touched, `quantity`) && getIn(formik.errors, `quantity`) && (
            <span className="text-error text-xs">
              {getIn(formik.errors, `quantity`)}
            </span>
          )}
        </>
      ),
      price: (
        <>
          <InputNumber
            id="price"
            name="price"
            min={0}
            value={formik.values.price}
            onChange={(value) => {
              formik.setFieldValue("price", value);
            }}
          />
          {getIn(formik.touched, `price`) && getIn(formik.errors, `price`) && (
            <span className="text-error text-xs">
              {getIn(formik.errors, `price`)}
            </span>
          )}
        </>
      ),
    },
  ];

  return (
    <Modal
      title="Create Listing"
      open={open}
      onCancel={handleCancel}
      onOk={formik.handleSubmit}
      footer={[
        <Button
          key="list-now"
          onClick={formik.handleSubmit}
          loading={isCreateMembershipSubmitting}
          type="primary"
        >
          List Now
        </Button>,
      ]}
    >
      <Form>
        <Table columns={columns} dataSource={data} pagination={false}></Table>
      </Form>
    </Modal>
  );
};

export default ListNowModal;
