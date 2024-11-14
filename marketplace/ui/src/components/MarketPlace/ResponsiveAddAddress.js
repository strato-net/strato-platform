import React, { useState } from 'react';
import TagManager from 'react-gtm-module';
import { Button, Form, Input } from 'antd';
import { useFormik } from 'formik';
import * as yup from 'yup';
import { actions } from '../../contexts/marketplace/actions';
import { useMarketplaceDispatch } from '../../contexts/marketplace';

const ResponsiveAddAddress = ({ close, redemptionService }) => {
  const [showAddress, setshowAddress] = useState(false);
  const marketplaceDispatch = useMarketplaceDispatch();
  const ShippingDetailsSchema = () => {
    return yup.object().shape({
      name: yup.string().required('Name is required'),
      zipcode: yup
        .string()
        .max(15)
        .required('Zipcode is required')
        .required('Zipcode is required'),
      addressLine1: yup.string().required('Address Line 1 is required'),
      addressLine2: yup.string().notRequired(),
      city: yup.string().required('City is required'),
      state: yup.string().required('State is required'),
      country: yup.string().required('Country is required'),
    });
  };

  const handleFormSubmit = async (values) => {
    setshowAddress(false);

    const body = {
      //shipping address
      name: encodeURIComponent(values.name),
      zipcode: values.zipcode,
      state: encodeURIComponent(values.state),
      city: encodeURIComponent(values.city),
      country: encodeURIComponent(values.country),
      addressLine1: encodeURIComponent(values.addressLine1),
      addressLine2: encodeURIComponent(values.addressLine2),
      redemptionService: redemptionService
        ? encodeURIComponent(redemptionService)
        : redemptionService,
    };

    window.LOQ.push([
      'ready',
      async (LO) => {
        // Track an event
        await LO.$internal.ready('events');
        LO.events.track('Add Shipping Address');
      },
    ]);
    TagManager.dataLayer({
      dataLayer: {
        event: 'add_shipping_address',
      },
    });
    let res = await actions.addShippingAddress(marketplaceDispatch, body);
    if (res != null) {
      await actions.fetchUserAddresses(marketplaceDispatch, redemptionService);
    }
  };
  const formik = useFormik({
    initialValues: {
      sameAddress: true,
      state: '',
      name: '',
      zipcode: '',
      addressLine1: '',
      addressLine2: '',
      city: '',
      country: '',
    },
    validationSchema: ShippingDetailsSchema,
    onSubmit: function (values, { resetForm }) {
      handleFormSubmit(values);
      resetForm();
      close();
    },
  });
  return (
    <Form layout="horizontal" className="">
      <div className="pt-2 px-4 overflow-y-auto">
        <p className="text-base md:text-xl lg:text-2xl text-[#202020] font-semibold mb-6">
          Add New Address
        </p>
        <div className="flex flex-col gap-[18px]">
          <Form.Item name="name" className="">
            <p className="text-left text-[#202020]  text-sm font-medium">
              Name
            </p>
            <Input
              label="name"
              name="name"
              className="h-[42px] pt-1  "
              placeholder="Enter Name"
              value={formik.values.name}
              onChange={formik.handleChange}
              style={{ fontSize: '16px' }}
            />
            {formik.touched.name && formik.errors.name && (
              <p className="text-error text-xs text-left">
                {formik.errors.name}
              </p>
            )}
          </Form.Item>

          <Form.Item label="" name="addressLine1" className="">
            <p className="text-left text-[#202020]  text-sm font-medium">
              Address line 1
            </p>
            <Input
              className="h-[42px] pt-1 "
              name="addressLine1"
              placeholder="Enter Address Line 1"
              value={formik.values.addressLine1}
              onChange={formik.handleChange}
              style={{ fontSize: '16px' }}
            />
            {formik.touched.addressLine1 && formik.errors.addressLine1 && (
              <p className="text-error text-xs text-left">
                {formik.errors.addressLine1}
              </p>
            )}
          </Form.Item>

          <Form.Item label="" name="" className="">
            <p className="text-left text-[#202020]  text-sm font-medium">
              Address line 2
            </p>
            <Input
              className="h-[42px] pt-1 "
              name="addressLine2"
              placeholder="Enter Address Line 2"
              value={formik.values.addressLine2}
              onChange={formik.handleChange}
              style={{ fontSize: '16px' }}
            />
            {formik.touched.addressLine2 && formik.errors.addressLine2 && (
              <p className="text-error text-xs  text-left">
                {formik.errors.addressLine2}
              </p>
            )}
          </Form.Item>
          <Form.Item label="" name="city" className="">
            <p className="text-[#202020]  text-sm font-medium text-left">
              City
            </p>
            <Input
              label="city"
              name="city"
              className="h-[42px] pt-1 "
              placeholder="Enter City"
              value={formik.values.city}
              onChange={formik.handleChange}
              style={{ fontSize: '16px' }}
            />
            {formik.touched.city && formik.errors.city && (
              <p className="text-error text-xs text-left">
                {formik.errors.city}
              </p>
            )}
          </Form.Item>
          <Form.Item label="" name="state" className="">
            <p className="text-[#202020]  text-sm font-medium text-left pb-1">
              State
            </p>
            <Input
              label="state"
              className="h-[42px] pt-1 "
              name="state"
              placeholder="Enter State"
              value={formik.values.state}
              onChange={formik.handleChange}
              style={{ fontSize: '16px' }}
            />
            {formik.touched.state && formik.errors.state && (
              <p className="text-error text-xs text-left">
                {formik.errors.state}
              </p>
            )}
          </Form.Item>
          <Form.Item label="" name="zipcode" className="">
            <p className="text-[#202020]  text-sm font-medium text-left">
              Zipcode
            </p>
            <Input
              label="zipcode"
              name="zipcode"
              className="h-[42px] pt-1 "
              placeholder="Enter Zipcode"
              maxLength={15}
              value={formik.values.zipcode}
              onChange={formik.handleChange}
              style={{ fontSize: '16px' }}
            />
            {formik.touched.zipcode && formik.errors.zipcode && (
              <p className="text-error text-xs text-left">
                {formik.errors.zipcode}
              </p>
            )}
          </Form.Item>
          <Form.Item label="" name="country" className="">
            <p className="text-[#202020] text-sm font-medium text-left">
              Country
            </p>
            <Input
              label="country"
              className="h-[42px] w-full  "
              name="country"
              placeholder="Enter Country"
              value={formik.values.country}
              onChange={formik.handleChange}
              style={{ fontSize: '16px' }}
            />
            {formik.touched.country && formik.errors.country && (
              <p className="text-error text-xs text-left">
                {formik.errors.country}
              </p>
            )}
          </Form.Item>
        </div>
      </div>

      <div className="flex justify-center px-[14px] py-[14px] mt-2 mb-6 !z-50">
        <div
          className="cursor-pointer justify-center flex items-center w-40 h-[42px] pt-1 border border-primary rounded bg-primary hover:bg-primaryHover text-white"
          onClick={formik.handleSubmit}
        >
          Add address
        </div>
      </div>
    </Form>
  );
};

export default ResponsiveAddAddress;
