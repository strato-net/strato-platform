import React, { useState } from "react";
import { useFormik } from "formik";
import { Form, Modal, InputNumber, Button, Spin, Table} from "antd";

const ListNowModal = ({ open, handleCancel, user, formik, isCreateMembershipSubmitting }) => {

  const seller = user.user.organization;
  const membership = formik.values.name



  const columns = [
    {
      title: 'Seller',
      dataIndex: 'seller',
      key: 'seller',
    },
    {
      title: 'Membership',
      dataIndex: 'membership',
      key: 'membership',
    },
    {
      title: 'Quantity',
      dataIndex: 'quantity',
      key: 'quantity',
    },
    {
      title: 'Price',
      dataIndex: 'price',
      key: 'price',
    },
  ];

  const data = [ 
    {
      key: '1',
      seller: seller,
      membership: membership,
      quantity:
        <InputNumber
          id="quantity"
          name="quantity"
          min={0}
          value={formik.values.quantity}
          onChange={(value) => {
            formik.setFieldValue("quantity", value)
          }}
        />
      ,
      price:
        <InputNumber
          id="price"
          name="price"
          min={0}
          value={formik.values.price}
          onChange={(value) => {
            formik.setFieldValue("price", value)
          }}
        />
    },
  ];

  return (
    <Modal
      title="Create Listing"
      open={open}
      onCancel={handleCancel}
      onOk={formik.handleSubmit}
      footer={[
        <Button key="list-now" onClick={formik.handleSubmit} loading={isCreateMembershipSubmitting} type="primary">
          List Now
        </Button>,
      ]}
    >
      <Form>
        <Table
          columns={columns}
          dataSource={data}
          pagination={false}
        >
          
        </Table>
      </Form>
    </Modal>
  );
};

export default ListNowModal;
