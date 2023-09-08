import React, { useState } from "react";
import { Form, Modal, InputNumber, Button, Spin,  Select, Table } from "antd";

const { Option } = Select;

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
  
  const handleFormatter = (value) => {
    if (value === '' || value === '.') {
      return '0.00';
    }

    const decimalParts = value.toString().split('.');
    if (decimalParts.length === 1) {
      return `${decimalParts[0]}.00`;
    } else if (decimalParts[1].length === 1) {
      return `${decimalParts[0]}.${decimalParts[1]}0`;
    } else {
      return `${decimalParts[0]}.${decimalParts[1].substring(0, 2)}`;
    }
  };

  const handleParser = (value) => {
    // Remove non-numeric characters and leading zeros
    const numericValue = value.replace(/[^\d.-]/g, '');
    const parsedValue = parseFloat(numericValue).toFixed(2);
    return isNaN(parsedValue) ? '' : parsedValue;
  };

  const selectAfter = (
  <Select 
    defaultValue="1"
    onChange={(value) => {formik.setFieldValue("isTaxPercentage", value === "1" )}}
    style={{ width: 60 }}>
      <Option value="0">$</Option>
      <Option value="1">%</Option>
  </Select>
);

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
      title: "Tax Percentage/Amount",
      dataIndex: "percentage",
      key: "precentage",
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
      percentage: (
        <>
          <InputNumber
            id="percentage"
            name="percentage"
            min={0}
            addonAfter={selectAfter}
            formatter={handleFormatter}
            parser={handleParser}
            value={formik.values.taxPercentage}
            onChange={(value) => {
              formik.setFieldValue("taxPercentage", value);
              formik.values.isTaxPercentage  ? 
                  (formik.setFieldValue("taxPercentageAmount", value))
                  :  (formik.setFieldValue("taxDollarAmount", value))
              !formik.values.isTaxPercentage ? 
                  (formik.setFieldValue("taxPercentageAmount", 0))
                  :  (formik.setFieldValue("taxDollarAmount", 0))
              console.log(formik.values);
            }}
          />
          {getIn(formik.touched, `taxPercentage`) && getIn(formik.errors, `percentage`) && (
            <span className="text-error text-xs">
              {getIn(formik.errors, `percentage`)}
            </span>
          )}
        </>),
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
      width={800}
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
