import React, { useState } from 'react';
import {
  Typography,
  Row,
  Button,
  Form,
  Input,
  Modal,
  Divider,
  Checkbox,
  Spin,
} from 'antd';
import { useFormik } from 'formik';
import * as yup from 'yup';

const ShippingDetailsSchema = () => {
  return yup.object().shape({
    name: yup.string().required('Name is required'),
    zipcode: yup
      .number()
      .required('Zipcode is required')
      .test(
        'len',
        'Must be exactly 5 digits',
        (val) => val && val.toString().length === 5
      ),
    addressLine1: yup.string().required('Address Line 1 is required'),
    addressLine2: yup.string().notRequired(),
    city: yup.string().required('City is required'),
    state: yup.string().required('State is required'),
    sameAddress: yup.boolean(),
    name_b: yup.string().when('sameAddress', {
      is: false,
      then: yup.string().required('Billing Name is required'),
    }),
    zipcode_b: yup.number().when('sameAddress', {
      is: false,
      then: yup
        .number()
        .required('Zipcode is required')
        .test(
          'len',
          'Must be exactly 5 digits',
          (val) => val && val.toString().length === 5
        ),
    }),
    addressLine1_b: yup.string().when('sameAddress', {
      is: false,
      then: yup.string().required('Address Line 1 is required'),
    }),
    addressLine2_b: yup.string().notRequired(),
    city_b: yup.string().when('sameAddress', {
      is: false,
      then: yup.string().required('City is required'),
    }),
    state_b: yup.string().when('sameAddress', {
      is: false,
      then: yup.string().required('State is required'),
    }),
  });
};

const { TextArea } = Input;
const { Text } = Typography;

const GetShippingDetailsModal = ({
  shippingDetailsModalOpen,
  setShippingDetailsModalOpen,
  actions,
  dispatch,
  isAddingShippingAddress,
}) => {
  const formik = useFormik({
    initialValues: {
      sameAddress: true,
      state: '',
      name: '',
      zipcode: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      state_b: '',
      name_b: '',
      zipcode_b: '',
      addressLine1_b: '',
      addressLine2_b: '',
      city_b: '',
    },
    validationSchema: ShippingDetailsSchema,
    onSubmit: function (values) {
      handleFormSubmit(values);
    },
  });

  const handleFormSubmit = async (values) => {
    let billingAddr;
    if (values.sameAddress) {
      billingAddr = {
        billingName: values.name,
        billingZipcode: values.zipcode,
        billingState: values.state,
        billingCity: values.city,
        billingAddressLine1: values.addressLine1,
        billingAddressLine2: values.addressLine2,
      };
    } else {
      billingAddr = {
        billingName: values.name_b,
        billingZipcode: values.zipcode_b,
        billingState: values.state_b,
        billingCity: values.city_b,
        billingAddressLine1: values.addressLine1_b,
        billingAddressLine2: values.addressLine2_b,
      };
    }

    const body = {
      //shipping address
      shippingName: values.name,
      shippingZipcode: values.zipcode,
      shippingState: values.state,
      shippingCity: values.city,
      shippingAddressLine1: values.addressLine1,
      shippingAddressLine2: values.addressLine2,

      //billing address
      ...billingAddr,
    };

    let res = await actions.addShippingAddress(dispatch, body);
    if (res != null) {
      setShippingDetailsModalOpen(false);
      await actions.fetchUserAddresses(dispatch);
    }
  };

  return (
    <Modal
      open={shippingDetailsModalOpen}
      centered
      onCancel={() => setShippingDetailsModalOpen(!shippingDetailsModalOpen)}
      width={672}
      className="my-10"
      title={
        <Text className="block text-center text-xl font-semibold">
          Add Shipping Address
        </Text>
      }
      footer={[
        <Row className="justify-center">
          <Button
            type="primary"
            className="h-9 bg-primary !hover:bg-primaryHover"
            onClick={formik.handleSubmit}
          >
            Add Shipping Address
          </Button>
        </Row>,
      ]}
    >
      <Divider />
      {isAddingShippingAddress ? (
        <div className="h-96 flex justify-center items-center">
          <Spin size="large" spinning={isAddingShippingAddress} />
        </div>
      ) : (
        <>
          <Form layout="vertical" className="mt-5">
            <div className="w-full">
              <div className="flex justify-between mb-4">
                <Form.Item label="Recipient Name" name="name" className="w-72">
                  <Input
                    label="name"
                    name="name"
                    placeholder="Enter Recipient Name"
                    value={formik.values.name}
                    onChange={formik.handleChange}
                  />
                  {formik.touched.name && formik.errors.name && (
                    <span className="text-error text-xs">
                      {formik.errors.name}
                    </span>
                  )}
                </Form.Item>

                <Form.Item label="Zipcode" name="zipcode" className="w-72">
                  <Input
                    label="zipcode"
                    name="zipcode"
                    placeholder="Enter Zipcode"
                    value={formik.values.zipcode}
                    onChange={formik.handleChange}
                  />
                  {formik.touched.zipcode && formik.errors.zipcode && (
                    <span className="text-error text-xs">
                      {formik.errors.zipcode}
                    </span>
                  )}
                </Form.Item>
              </div>

              <div className="flex justify-between mb-4">
                <Form.Item label="State" name="state" className="w-72">
                  <Input
                    label="state"
                    name="state"
                    placeholder="Enter State"
                    value={formik.values.state}
                    onChange={formik.handleChange}
                  />
                  {formik.touched.state && formik.errors.state && (
                    <span className="text-error text-xs">
                      {formik.errors.state}
                    </span>
                  )}
                </Form.Item>

                <Form.Item label="City" name="city" className="w-72">
                  <Input
                    label="city"
                    name="city"
                    placeholder="Enter City"
                    value={formik.values.city}
                    onChange={formik.handleChange}
                  />
                  {formik.touched.city && formik.errors.city && (
                    <span className="text-error text-xs">
                      {formik.errors.city}
                    </span>
                  )}
                </Form.Item>
              </div>

              <div className="flex justify-between items-start mb-4">
                <Form.Item
                  label="Address Line 1"
                  name="addressLine1"
                  className="w-72"
                >
                  <TextArea
                    rows={3}
                    name="addressLine1"
                    placeholder="Enter Address Line 1"
                    value={formik.values.addressLine1}
                    onChange={formik.handleChange}
                  />
                  {formik.touched.addressLine1 &&
                    formik.errors.addressLine1 && (
                      <span className="text-error text-xs">
                        {formik.errors.addressLine1}
                      </span>
                    )}
                </Form.Item>

                <Form.Item
                  label="Address Line 2"
                  name="addressLine2"
                  className="w-72"
                >
                  <TextArea
                    rows={3}
                    name="addressLine2"
                    placeholder="Enter Address Line 2"
                    value={formik.values.addressLine2}
                    onChange={formik.handleChange}
                  />
                  {formik.touched.addressLine2 &&
                    formik.errors.addressLine2 && (
                      <span className="text-error text-xs">
                        {formik.errors.addressLine2}
                      </span>
                    )}
                </Form.Item>
              </div>
            </div>
          </Form>
          <Divider className="mb-0" />
        </>
      )}
    </Modal>
  );
};

export default GetShippingDetailsModal;
