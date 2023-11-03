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

const { StatusValue, statusOptions, discountTypeVal } = helperJson;
const { Text } = Typography;

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
    fields
  },
}) => {
  const { isCreateInventorySubmitting, isinventoryUpdating, inventoryDetails } =
    useInventoryState();

  const { isuploadImageSubmitting } = useProductState();
  let { isResaleMembershipSubmitting } =
    useMembershipState();

  const isSubmit =
    isCreateMembershipSubmitting ||
    isResaleMembershipSubmitting ||
    isuploadImageSubmitting ||
    isCreateInventorySubmitting ||
    isinventoryUpdating;


  const statusVal =
    inventoryDetails?.status ||
    membershipStatus ||
    formik.values?.tempInv?.status;

  const handleTypeBtn = (status) => {
    formik.setFieldValue("isTaxPercentage", status);
    formik.setFieldValue(discountTypeVal[status], formik.values.taxPercentage);
    formik.setFieldValue(discountTypeVal[!status], 0);
  };

  const values = {
    seller: (user?.user?.user?.organization || user?.user.organization),
    membership: formik.values.name,
    membershipNumber: id,
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
          {fields.map(({ key, label, type, disabled, size, min, step, precision, addOn, addonBefore, hidden }) => (
            !hidden && <Col span={8} key={key}>
              <Row>
                <Text className="font-medium">{label}</Text>
              </Row>
              <Row className="mt-2">
                {type === "input" && (
                  <Input
                    type="text"
                    value={values[key]}
                    size={size}
                    disabled={disabled}
                    className={`w-full ${disabled ? 'cursor-not-allowed' : ''}`}
                  />
                )}
                {type === "inputNumber" && (
                  <InputNumber
                    id={key}
                    name={key}
                    min={min}
                    type="number"
                    step={step}
                    precision={precision}
                    addonBefore={addonBefore}
                    className="w-full"
                    addonAfter={addOn &&
                      <Row className="flex w-16 h-8 border-grey rounded-md justify-between cursor-pointer">
                        {["%", "$"].map((type, index) => (
                          <Col
                            span={12}
                            className="p-1"
                            style={{
                              backgroundColor: formik.values.isTaxPercentage === (index === 0) ? "#F2F2F5" : "",
                            }}
                            onClick={() => {
                              handleTypeBtn(index === 0);
                            }}
                          >
                            {type}
                          </Col>
                        ))}
                      </Row>
                    }
                    size={size}
                    disabled={disabled}
                    controls={false}
                    value={formik.values[key]}
                    onChange={(value) => {
                      formik.setFieldValue(key, value);
                      if (key === 'taxPercentage') {
                        let btnStatus = formik.values.isTaxPercentage;
                        formik.setFieldValue(discountTypeVal[btnStatus], value);
                        formik.setFieldValue(discountTypeVal[!btnStatus], 0);
                      }
                    }}
                  />
                )}
                {type === "select" && (
                  <Select
                    placeholder={label}
                    className="w-full"
                    size={size}
                    defaultValue={StatusValue[formik?.values?.inventoryStatus]}
                    onChange={(value) => {
                      formik.setFieldValue(key, value);
                    }}
                    options={statusOptions}
                  />
                )}
              </Row>
            </Col>
          ))}
        </Row>
      </Form>
    </Modal>
  );
};

export default ListNowModal;
