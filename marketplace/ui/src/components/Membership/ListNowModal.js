import React, { useState } from "react";
import { Form, Modal, InputNumber, Button, Input, Spin, Select, Table, Typography, Row, Col } from "antd";
import helperJson from "../../helpers/helper.json"
import { useInventoryState } from "../../contexts/inventory";
import { useMembershipState } from "../../contexts/membership";
import { useProductState } from "../../contexts/product";
import { useParams } from "react-router-dom";
const { columns, taxOptions } = helperJson;
const { Text, Title } = Typography;
const ListNowModal = ({
  open,
  handleCancel,
  user,
  formik,
  // type,
  id,
  getIn,
  isCreateMembershipSubmitting,
}) => {
  const { type } = useParams()
  const isIssued = type === 'issued';
  const { isInventoriesLoading, inventories, isCreateInventorySubmitting } = useInventoryState();
  const { isuploadImageSubmitting } = useProductState()
  // const inventoryQuantity = type == 'Sale' ? inventories[0]?.availableQuantity : 99999;
  const seller = user?.user?.user?.organization || user?.user?.organization;
  const membership = formik.values.name;
  let { isResaleMembershipSubmitting } = useMembershipState();
  const isSubmit = isCreateMembershipSubmitting || isResaleMembershipSubmitting || isuploadImageSubmitting || isCreateInventorySubmitting;
  // const { type } = useParams();

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

  return (
    <Modal
      // width={800}
      style={{ maxWidth: '720px' }}
      width="auto"
      title={<Text className="text-xl font-semibold">Create Listing</Text>}
      open={open}
      onCancel={handleCancel}
      onOk={formik.handleSubmit}
      footer={[
        <Row>
          <Button
            key="list-now"
            className="mx-auto w-52"
            onClick={formik.handleSubmit}
            loading={isSubmit}
            type="primary"
          >
            List Now
          </Button>
        </Row>
      ]}
    >

      <hr style={{ color: '#e6d8d8', marginTop: '5px' }} />
      <Form className="mt-10">

        <Row gutter={[48, 12]}>
          <Col span={8}>
            <Row> <Text className="font-medium">Seller</Text> </Row>
            <Row><Input type="text" value={seller} size="large" disabled={true} className="w-full mt-2 cursor-not-allowed" /> </Row>
          </Col>
          <Col span={8}>
            <Row><Text className="font-medium">Membership</Text> </Row>
            <Row> <Input type="text" value={membership} size="large" disabled={true} className="w-full mt-2 cursor-not-allowed" /> </Row>
          </Col>
          <Col span={8}>
            <Row> <Text className="font-medium">ID</Text></Row>
            <Row><Input type="text" value={id} size="large" disabled={true} className="w-full mt-2 cursor-not-allowed" /></Row>
          </Col>
          <Col span={8}>
            <Row> <Text className="font-medium">Quantity</Text></Row>
            <Row><InputNumber
              id="quantity"
              name="quantity"
              min={0}
              // max={inventoryQuantity}
              className="w-full mt-2"
              size="large"
              prefix={isInventoriesLoading && <Spin />}
              disabled={!isIssued}
              // value={1}
              controls={false}
              value={isIssued ? formik.values.quantity : 1}
              onChange={(value) => {
                formik.setFieldValue("quantity", value);
              }}
            /></Row>
          </Col>
          <Col span={8}>
            <Row> <Text className="font-medium">Tax Percentage/Amount</Text></Row>
            <Row> <InputNumber
              id="percentage"
              name="percentage"
              min={0}
              addonAfter={<Row className="flex w-16 h-8 border-grey rounded-md justify-between cursor-pointer">
                <Col span={12} className="p-1"
                  style={{ backgroundColor: formik.values.isTaxPercentage ? "#F2F2F5" : "" }}
                  onClick={() => { formik.setFieldValue("isTaxPercentage", true) }}>
                  %
                </Col>
                <Col span={12} className="p-1"
                  style={{ backgroundColor: !formik.values.isTaxPercentage ? "#F2F2F5" : "" }}
                  onClick={() => { formik.setFieldValue("isTaxPercentage", false) }}>
                  $
                </Col>
              </Row>}
              formatter={handleFormatter}
              className="w-full mt-2"
              size="large"
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
            /></Row>
          </Col>
          <Col span={8}>
            <Row> <Text className="font-medium">Price</Text></Row>
            <Row><InputNumber
              addonBefore="$"
              id="price"
              name="price"
              className="w-full mt-2"
              min={0}
              size="large"
              controls={false}
              value={formik.values.price}
              onChange={(value) => {
                formik.setFieldValue("price", value);
              }}
            /></Row>
          </Col>
          <Col span={8}>
            <Row> <Text className="font-medium">Type</Text></Row>
            <Row><Input type="text" value={'Sale'} size="large" disabled={true} className="w-full mt-2 cursor-not-allowed" /> </Row>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
};

export default ListNowModal;
