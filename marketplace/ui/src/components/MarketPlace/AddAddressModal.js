import React,{useState} from "react";
import TagManager from "react-gtm-module";
import { Modal , Form, Input, Typography } from "antd";
import { useFormik } from "formik";
import * as yup from "yup";

import { actions } from "../../contexts/marketplace/actions";
import { actions as orderActions } from "../../contexts/order/actions";
import {
  useMarketplaceState,
  useMarketplaceDispatch,
} from "../../contexts/marketplace";



const AddAddressModal = ({open , close }) => {
    const [showAddress, setshowAddress] = useState(false);
    const marketplaceDispatch = useMarketplaceDispatch();
    const ShippingDetailsSchema = () => {
      return yup.object().shape({
        name: yup.string().required("Name is required"),
        zipcode: yup.string().max(15).required("Zipcode is required")
          .required("Zipcode is required"),
        addressLine1: yup.string().required("Address Line 1 is required"),
        addressLine2: yup.string().notRequired(),
        city: yup.string().required("City is required"),
        state: yup.string().required("State is required"),
        sameAddress: yup.boolean(),
        name_b: yup.string().when("sameAddress", {
          is: false,
          then: yup.string().required("Name is required"),
        }),
        zipcode_b: yup.number().when("sameAddress", {
          is: false,
          then: yup.string().max(15).required("Zipcode is required"),
        }),
        addressLine1_b: yup.string().when("sameAddress", {
          is: false,
          then: yup.string().required("Address Line 1 is required"),
        }),
        addressLine2_b: yup.string().notRequired(),
        city_b: yup.string().when("sameAddress", {
          is: false,
          then: yup.string().required("City is required"),
        }),
        state_b: yup.string().when("sameAddress", {
          is: false,
          then: yup.string().required("State is required"),
        }),
      });
    };
    
    const handleFormSubmit = async (values) => {
      setshowAddress(false);
      let billingAddr;
      if (values.sameAddress) {
        billingAddr = {
          billingName: encodeURIComponent(values.name),
          billingZipcode: values.zipcode,
          billingState: encodeURIComponent(values.state),
          billingCity: encodeURIComponent(values.city),
          billingAddressLine1: encodeURIComponent(values.addressLine1),
          billingAddressLine2: encodeURIComponent(values.addressLine2)
        }
      } else {
        billingAddr = {
          billingName: encodeURIComponent(values.name_b),
          billingZipcode: values.zipcode_b,
          billingState: encodeURIComponent(values.state_b),
          billingCity: encodeURIComponent(values.city_b),
          billingAddressLine1: encodeURIComponent(values.addressLine1_b),
          billingAddressLine2: encodeURIComponent(values.addressLine2_b)
        }
      }
    
      const body = {
        //shipping address
        shippingName: encodeURIComponent(values.name),
        shippingZipcode: values.zipcode,
        shippingState: encodeURIComponent(values.state),
        shippingCity: encodeURIComponent(values.city),
        shippingAddressLine1: encodeURIComponent(values.addressLine1),
        shippingAddressLine2: encodeURIComponent(values.addressLine2),
    
        //billing address
        ...billingAddr
      };
    
      window.LOQ.push(['ready', async LO => {
        // Track an event
        await LO.$internal.ready('events')
        LO.events.track('Add Shipping Address')
      }])
      TagManager.dataLayer({
        dataLayer: {
          event: 'add_shipping_address',
        },
      });
      let res = await actions.addShippingAddress(marketplaceDispatch, body);
      if (res != null) {
        await actions.fetchUserAddresses(marketplaceDispatch);
      }
    };
    const { TextArea } = Input;
    const formik = useFormik({
        initialValues: {
          sameAddress: true,
          state: "",
          name: "",
          zipcode: "",
          addressLine1: "",
          addressLine2: "",
          city: "",
          state_b: "",
          name_b: "",
          zipcode_b: "",
          addressLine1_b: "",
          addressLine2_b: "",
          city_b: "",
        },
        validationSchema: ShippingDetailsSchema,
        onSubmit: function (values) {
          handleFormSubmit(values)
          close();
        },
      });
    
  return (
    <Modal
    closable
    centered
      width={786}
    open={open}
    onCancel={close}
    title={
      <div className="px-[30px] flex justify-between border-b border-[#BABABA]">
        <Typography className="text-xl text-[#202020] font-semibold">Add new address</Typography>

      </div>
    }
    footer={
      <Form layout="vertical" className="mt-5">
      <div className="border-b border-[#BABABA]">
        <div className="flex justify-between gap-4 pb-6">
          <Form.Item  name="name" className="">
            <p className="text-left text-[#202020] font-medium">Name</p>
            <Input
              label="name"
              name="name"
              className="h-[42px] w-[330px] lg:w-[354px] "
              placeholder="Enter Name"
              value={formik.values.name}
              onChange={formik.handleChange}
            />
            {formik.touched.name && formik.errors.name && (
             <p className="text-error text-xs text-left">
                {formik.errors.name}
             </p>
            )}
          </Form.Item>

          <Form.Item
            label=""
            name="addressLine1"
            className=""
          >
             <p className="text-left text-[#202020] font-medium">Address Line 1</p>
            <Input
            
              className="h-[42px] w-[330px] lg:w-[354px] "
              name="addressLine1"
              placeholder="Enter Address Line 1"
              value={formik.values.addressLine1}
              onChange={formik.handleChange}
            />
            {formik.touched.addressLine1 && formik.errors.addressLine1 && (
             <p className="text-error text-xs text-left">
                {formik.errors.addressLine1}
             </p>
            )}
          </Form.Item>
        </div>

        <div className="flex justify-between pb-6">
         
        <Form.Item
            label=""
            name=""
            className=""
          >
            <p className="text-left text-[#202020] font-medium">Address Line 2</p>
            <Input
              className="h-[42px] w-[330px] lg:w-[354px] "
              name="addressLine2"
              placeholder="Enter Address Line 2"
              value={formik.values.addressLine2}
              onChange={formik.handleChange}
            />
            {formik.touched.addressLine2 && formik.errors.addressLine2 && (
             <p className="text-error text-xs  text-left">
                {formik.errors.addressLine2}
             </p>
            )}
          </Form.Item>
          <Form.Item label="" name="city" className="">
          <p className="text-[#202020] font-medium text-left">City</p>
            <Input
              label="city"
              name="city"
              className="h-[42px] w-[330px] lg:w-[354px] "
              placeholder="Enter City"
              value={formik.values.city}
              onChange={formik.handleChange}
            />
            {formik.touched.city && formik.errors.city && (
             <p className="text-error text-xs text-left">
                {formik.errors.city}
             </p>
            )}
          </Form.Item>
        </div>

        <div className="flex justify-between items-start pb-6">
        <Form.Item label="" name="state" className="">
        <p className="text-[#202020] font-medium text-left">State</p>
            <Input
              label="state"
              className="h-[42px] w-[330px] lg:w-[354px] "
              name="state"
              placeholder="Enter State"
              value={formik.values.state}
              onChange={formik.handleChange}
            />
            {formik.touched.state && formik.errors.state && (
             <p className="text-error text-xs text-left">
                {formik.errors.state}
             </p>
            )}
          </Form.Item>

         
          <Form.Item label="" name="zipcode" className="">
            <p className="text-[#202020] font-medium text-left">Zipcode</p>
            <Input
              label="zipcode"
              name="zipcode"
              className="h-[42px] w-[330px] lg:w-[354px]  "
              placeholder="Enter Zipcode"
              maxLength={15}
              value={formik.values.zipcode}
              onChange={formik.handleChange}
            />
            {formik.touched.zipcode && formik.errors.zipcode && (
             <p className="text-error text-xs text-left">
                {formik.errors.zipcode}
             </p>
            )}
          </Form.Item>
        </div>

      </div>
      <div className="flex justify-center pt-6" id="add-address-button">
        <div className="cursor-pointer justify-center flex items-center w-40 h-9  border border-primary rounded bg-primary hover:bg-primaryHover text-white"
          onClick={formik.handleSubmit}>
          Add address
        </div>
      </div>
    </Form>
    }

    />
  )
}

export default AddAddressModal