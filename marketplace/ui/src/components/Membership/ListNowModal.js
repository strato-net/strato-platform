import React, { useState } from "react";
import { Form, Modal, InputNumber, Button, Spin, Select, Table } from "antd";
import helperJson from "../../helpers/helper.json"
import { useInventoryState } from "../../contexts/inventory";
const { columns, taxOptions } = helperJson;

const ListNowModal = ({
  open,
  handleCancel,
  user,
  formik,
  type,
  id,
  getIn,
  isCreateMembershipSubmitting,
}) => {
  const { isInventoriesLoading, inventories } = useInventoryState();

  const seller = user.user.user.organization;
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
      onChange={(value) => { formik.setFieldValue("isTaxPercentage", value === "1") }}
      style={{ width: 60 }}
      options={taxOptions}
    />
  );


  const data = [
    {
      key: "1",
      seller: seller,
      membership: membership,
      id: id,
      quantity: (
        <>
          <InputNumber
            id="quantity"
            name="quantity"
            min={0}
            // max={inventories[0]?.availableQuantity}
            // disabled={true}
            // value={1}
            controls={false}
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
            controls={false}
            parser={handleParser}
            value={formik.values.taxPercentage}
            onChange={(value) => {
              formik.setFieldValue("taxPercentage", value);
              formik.values.isTaxPercentage ?
                (formik.setFieldValue("taxPercentageAmount", value))
                : (formik.setFieldValue("taxDollarAmount", value))
              !formik.values.isTaxPercentage ?
                (formik.setFieldValue("taxPercentageAmount", 0))
                : (formik.setFieldValue("taxDollarAmount", 0))
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
            controls={false}
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
      type: type,
    },
  ];

  return (
    <Modal
      // width={800}
      style={{ maxWidth: '1000px' }}
      width="auto"
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
        <Table loading={isInventoriesLoading} columns={columns} dataSource={data} pagination={false}></Table>
      </Form>
    </Modal>
  );
};

export default ListNowModal;
