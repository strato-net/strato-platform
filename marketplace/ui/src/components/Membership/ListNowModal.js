import React from "react";
import {
  Form,
  Modal,
  InputNumber,
  Button,
  Input,
  Select,
  Typography,
  Row,
  Col,
} from "antd";

import helperJson from "../../helpers/helper.json";
import { useInventoryState } from "../../contexts/inventory";
import { useMembershipState } from "../../contexts/membership";
import { useProductState } from "../../contexts/product";

const { StatusValue } = helperJson;
const { Text } = Typography;

const statusOptions = [
  { value: 1, label: "Published" },
  { value: 2, label: "Unpublished" },
];

const discountTypeVal = {
  true: "taxPercentageAmount",
  false: "taxDollarAmount",
};

const ListNowModal = ({
  open,
  handleCancel,
  user,
  formik,
  id,
  membershipStatus,
  isCreateMembershipSubmitting,
  config: {
    title,
    isMembershipNumber,
    quantityDisabled,
    priceDisabled,
    isStatusVisible,
    statusDropDown,
  },
}) => {
  const { isCreateInventorySubmitting, isinventoryUpdating, inventoryDetails } =
    useInventoryState();

  const { isuploadImageSubmitting } = useProductState();
  const seller = user?.user?.user?.organization || user?.user?.organization;
  const membership = formik.values.name;
  let { isResaleMembershipSubmitting } =
    useMembershipState();

  const isSubmit =
    isCreateMembershipSubmitting ||
    isResaleMembershipSubmitting ||
    isuploadImageSubmitting ||
    isCreateInventorySubmitting ||
    isinventoryUpdating;

  const handleStatus = (value) => {
    formik.setFieldValue("inventoryStatus", value);
  };

  const statusVal =
    inventoryDetails?.status ||
    membershipStatus ||
    formik.values?.tempInv?.status;

  const handleTypeBtn = (status) => {
    formik.setFieldValue("isTaxPercentage", status);
    formik.setFieldValue(discountTypeVal[status], formik.values.taxPercentage);
    formik.setFieldValue(discountTypeVal[!status], 0);
  };

  return (
    <Modal
      style={{ maxWidth: "720px" }}
      width="auto"
      title={<Text className="text-xl font-semibold">{title}</Text>}
      open={open}
      onCancel={handleCancel}
      onOk={formik.handleSubmit}
      footer={[
        <Row>
          <Button
            key="list-now"
            className="mx-auto w-52 mt-10"
            onClick={formik.handleSubmit}
            loading={isSubmit}
            size="large"
            type="primary"
          >
            Save
          </Button>
        </Row>,
      ]}
    >
      <hr style={{ color: "#e6d8d8", marginTop: "5px" }} />
      <Form className="mt-10">
        <Row gutter={[48, 12]}>
          <Col span={8}>
            <Row>
              <Text className="font-medium">Seller</Text>
            </Row>
            <Row>
              <Input
                type="text"
                value={seller}
                size="large"
                disabled={true}
                className="w-full mt-2 cursor-not-allowed"
              />
            </Row>
          </Col>
          <Col span={8}>
            <Row>
              <Text className="font-medium">Membership</Text>
            </Row>
            <Row>
              <Input
                type="text"
                value={membership}
                size="large"
                disabled={true}
                className="w-full mt-2 cursor-not-allowed"
              />
            </Row>
          </Col>
          {isMembershipNumber && (
            <Col span={8}>
              <Row>
                <Text className="font-medium">Membership Number</Text>
              </Row>
              <Row>
                <Input
                  type="text"
                  value={id}
                  size="large"
                  disabled={true}
                  className="w-full mt-2 cursor-not-allowed"
                />
              </Row>
            </Col>
          )}
          <Col span={8}>
            <Row>
              <Text className="font-medium">Quantity</Text>
            </Row>
            <Row>
              <InputNumber
                id="quantity"
                name="quantity"
                min={0}
                className="w-full mt-2"
                size="large"
                disabled={quantityDisabled}
                controls={false}
                value={formik.values.quantity}
                onChange={(value) => {
                  formik.setFieldValue("quantity", value);
                }}
              />
            </Row>
          </Col>
          <Col span={8}>
            <Row>
              <Text className="font-medium">Tax Percentage/Amount</Text>
            </Row>
            <Row className="mt-2">
              <InputNumber
                id="percentage"
                name="percentage"
                min={0}
                step={1}
                precision={0}
                addonAfter={
                  <Row className="flex w-16 h-8 border-grey rounded-md justify-between cursor-pointer">
                    <Col
                      span={12}
                      className="p-1"
                      style={{
                        backgroundColor: formik.values.isTaxPercentage
                          ? "#F2F2F5"
                          : "",
                      }}
                      onClick={() => {
                        handleTypeBtn(true);
                      }}
                    >
                      %
                    </Col>
                    <Col
                      span={12}
                      className="p-1"
                      style={{
                        backgroundColor: !formik.values.isTaxPercentage
                          ? "#F2F2F5"
                          : "",
                      }}
                      onClick={() => {
                        handleTypeBtn(false);
                      }}
                    >
                      $
                    </Col>
                  </Row>
                }
                className="w-full"
                size="large"
                controls={false}
                value={formik.values.taxPercentage}
                onChange={(value) => {
                  let btnStatus = formik.values.isTaxPercentage;
                  formik.setFieldValue(discountTypeVal[btnStatus], value);
                  formik.setFieldValue(discountTypeVal[!btnStatus], 0);
                  formik.setFieldValue("taxPercentage", value);
                }}
              />
            </Row>
          </Col>
          <Col span={8}>
            <Row>
              <Text className="font-medium">Price</Text>
            </Row>
            <Row className="mt-2">
              <InputNumber
                addonBefore="$"
                id="price"
                name="price"
                className="w-full"
                min={0}
                size="large"
                controls={false}
                disabled={priceDisabled}
                value={formik.values.price}
                onChange={(value) => {
                  formik.setFieldValue("price", value);
                }}
              />
            </Row>
          </Col>
          {isStatusVisible && (
            <Col span={8}>
              <Row>
                <Text className="font-medium">Status</Text>
              </Row>
              <Row>
                {statusDropDown ? (
                  <Select
                    placeholder="Status"
                    className="mt-2 w-full"
                    size="large"
                    defaultValue={
                      StatusValue[
                        formik?.values?.tempInv?.status ||
                          formik?.values?.inventoryStatus
                      ]
                    }
                    onChange={(value) => {
                      handleStatus(value);
                    }}
                    options={statusOptions}
                  />
                ) : (
                  <Input
                    type="text"
                    value={StatusValue[statusVal] ?? "UnPublished"}
                    size="large"
                    disabled={true}
                    className="w-full mt-2 cursor-not-allowed"
                  />
                )}
              </Row>
            </Col>
          )}
        </Row>
      </Form>
    </Modal>
  );
};

export default ListNowModal;
