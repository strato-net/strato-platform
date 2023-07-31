import React, { useEffect, useState } from "react";
import {
  Typography,
  Row,
  Button,
  Form,
  Input,
  Modal,
  Divider,
  Select,
  DatePicker,
  Spin,
  Upload,
  notification,
} from "antd";
import { useFormik, getIn } from "formik";
import * as yup from "yup";
import { DownloadOutlined, PaperClipOutlined } from "@ant-design/icons";
//categories
import { actions as categoryActions } from "../../contexts/category/actions";
import { useCategoryDispatch, useCategoryState } from "../../contexts/category";

//product
import { actions as productActions } from "../../contexts/product/actions";
import { useProductDispatch, useProductState } from "../../contexts/product";
//event types
import { actions as EventTypeActions } from "../../contexts/eventType/actions";
import { useEventTypeDispatch, useEventTypeState } from "../../contexts/eventType";
//certifier
import { actions as certifierActions } from "../../contexts/certifier/actions";
import { useCertifiersDispatch, useCertifiersState } from "../../contexts/certifier";
import dayjs from 'dayjs';
import { downloadSample } from "../../helpers/utils";
import { usePapaParse } from "react-papaparse";
import { actions as eventActions } from "../../contexts/event/actions";
import useDebounce from "../UseDebounce";

const EventSchema = () => {
  return yup.object().shape({
    category: yup.object().shape({
      name: yup.string().required("Category is required").nullable(),
    }),
    product: yup.object().shape({
      name: yup.string().required("Product Name is required").nullable(),
    }),
    date: yup.date().required("Date is required").nullable(),
    certifier: yup.object().shape({
      name: yup.string().nullable().notRequired(),
    }),
    eventType: yup.object().shape({
      name: yup.string().required("Event type is required").nullable(),
    }),
    summary: yup.string().required("Summary is required"),
    serialNumber: yup.object().shape({
      serialNumStr: yup.string().required("Serial Number is required").nullable(),
    })
  });
};

const { Option } = Select;
const { TextArea } = Input;
const { Text } = Typography;

const CreateEventModal = ({
  isCreateEventModalOpen,
  toggleCreateEventModal,
  dispatch,
  actions,
  isCreateEventSubmitting,
  organization,
}) => {
  const [uploadErr, setUploadErr] = useState("");
  const [api, contextHolder] = notification.useNotification();
  const { readString } = usePapaParse();

  //Categories
  const categoryDispatch = useCategoryDispatch();
  const { categorys, iscategorysLoading } = useCategoryState();

  //product
  const productDispatch = useProductDispatch();
  const { categoryBasedProducts, isCategoryBasedProductsLoading } =
    useProductState();

  //event type
  const eventTypeDispatch = useEventTypeDispatch();
  const {
    isEventTypesLoading,
    eventTypes
  } = useEventTypeState();

  //certifier
  const certifierDispatch = useCertifiersDispatch();
  const {
    isCertifiersLoading,
    certifiers
  } = useCertifiersState();

  const formik = useFormik({
    initialValues: {
      category: {
        name: null,
        address: null,
      },
      product: {
        name: null,
        address: "",
      },
      date: "",
      certifier: {
        name: null,
        address: "",
      },
      eventType: {
        name: null,
        address: "",
      },
      summary: "",
      serialNumber: {
        serialNumStr: "",
        serialNumArr: [],
      },
    },
    validationSchema: EventSchema,
    onSubmit: function (values) {

      handleFormSubmit(values);
    },
  });

  const eventQueryValue = "";
  const debouncedEventSearchTerm = useDebounce(eventQueryValue, 1000);

  const handleFormSubmit = async (values) => {
    const body = {
      eventTypeId: values.eventType.address,
      productId: values.product.address,
      date: dayjs(values.date).unix(),
      certifier: values.certifier.address,
      summary: encodeURIComponent(values.summary),
      serialNumbers: values.serialNumber.serialNumArr
    };

    let isDone = await actions.createEvent(dispatch, body);
    if (isDone) {
      eventActions.fetchEvent(dispatch, 10, 0, debouncedEventSearchTerm, organization);
      toggleCreateEventModal(false);
    }
  };

  useEffect(() => {
    categoryActions.fetchCategories(categoryDispatch);
  }, [categoryDispatch]);

  useEffect(() => {
    productActions.fetchCategoryBasedProduct(
      productDispatch,
      formik.values.category.name,
    );
  }, [
    productDispatch,
    formik.values.category.name,
  ]);

  useEffect(() => {
    EventTypeActions.fetchEventType(eventTypeDispatch);
  }, [eventTypeDispatch]);

  useEffect(() => {
    certifierActions.fetchCertifiers(certifierDispatch);
  }, [certifierDispatch]);

  const uploadCSV = (e) => {
    const csvFile = e.file.originFileObj;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const contents = readString(reader.result, { header: true });

      if (contents.data.length === 0) {
        setUploadErr("No records to import");
        return;
      }

      if (!contents.data[0]["ItemSerialNumber"]) {
        setUploadErr("Missing required column 'ItemSerialNumber'");
        return;
      }

      let serialNumbers = "",
        serialNumArr = [];
      for (let i = 0; i < contents.data.length; i++) {
        const row = contents.data[i];
        if (row["ItemSerialNumber"]) {
          serialNumArr.push(row["ItemSerialNumber"]);
          serialNumbers += row["ItemSerialNumber"] + ",";
        }
      }
      serialNumbers = serialNumbers.substring(0, serialNumbers.length - 1);
      formik.setFieldValue("serialNumber.serialNumStr", serialNumbers);
      formik.setFieldValue("serialNumber.serialNumArr", serialNumArr);
    };
    reader.readAsText(csvFile);
  };

  const openToast = (placement) => {
    api.error({
      message: uploadErr,
      onClose: setUploadErr(""),
      placement,
      key: 1,
    });
  };

  return (
    <>
      {contextHolder}
      <Modal
        open={isCreateEventModalOpen}
        centered
        onCancel={() => toggleCreateEventModal(!isCreateEventModalOpen)}
        width={672}
        title={
          <Text id="modal-title" className="block text-center text-xl font-semibold">
            Add Event
          </Text>
        }
        footer={[
          <Row className="justify-center">
            <Button
              id="add-event-button"
              type="primary"
              className="w-40 h-9 bg-primary !hover:bg-primaryHover"
              onClick={formik.handleSubmit}
              disabled={isCreateEventSubmitting}
            >
              {isCreateEventSubmitting ? <Spin /> : "Add Event"}

            </Button>
          </Row>,
        ]}
      >
        <Divider />
        {isEventTypesLoading || iscategorysLoading ? (
          <div className="h-96 flex justify-center items-center">
            <Spin size="large" />
          </div>
        ) : (<>
          <Form layout="vertical" className="mt-5">
            <div className="w-full">
              <div className="flex justify-between mb-4">
                <Form.Item label="Category" name="category" className="w-72">
                  <Select
                    id="category"
                    placeholder="Select Category"
                    showSearch
                    allowClear
                    name="category.name"
                    disabled={false}
                    value={formik.values.category.name}
                    onChange={(value) => {
                      formik.setFieldValue("category.name", value);
                      formik.setFieldValue("productName.name", null);
                    }}
                  >
                    {categorys.map((e, index) => (
                      <Option value={e.name} key={index}>
                        {e.name}
                      </Option>
                    ))}
                  </Select>
                  {getIn(formik.touched, "category.name") &&
                    getIn(formik.errors, "category.name") && (
                      <span className="text-error text-xs">
                        {getIn(formik.errors, "category.name")}
                      </span>
                    )}
                </Form.Item>
              </div>
              <div className="flex justify-between mb-4">
                <Form.Item
                  label="Product"
                  name="product"
                  className="w-72"
                >
                  <Select
                    id="product"
                    placeholder="Select Product"
                    allowClear
                    showSearch
                    name="product.name"
                    value={formik.values.product.name}
                    loading={isCategoryBasedProductsLoading}
                    disabled={
                      !formik.values.category || isCategoryBasedProductsLoading
                    }
                    onChange={(value) => {
                      let selectedProduct = { address: "" };
                      if (value) {
                        selectedProduct = categoryBasedProducts.find(
                          (e) => e.name === value
                        );
                      }
                      formik.setFieldValue("product.name", value);
                      formik.setFieldValue(
                        "product.address",
                        selectedProduct.address
                      );
                      formik.setFieldTouched("product.name", false, false);
                    }}
                  >
                    {categoryBasedProducts.map((e, index) => (
                      <Option value={e.name} key={index}>
                        {decodeURIComponent(e.name)}
                      </Option>
                    ))}
                  </Select>

                  {getIn(formik.touched, "product.name") &&
                    getIn(formik.errors, "product.name") && (
                      <span className="text-error text-xs">
                        {getIn(formik.errors, "product.name")}
                      </span>
                    )}
                </Form.Item>
                <Form.Item
                  label="Select Date"
                  name="date"
                  className="w-72"
                >
                  <DatePicker
                    placeholder="Select Date"
                    allowClear
                    className="w-72"
                    name="date"
                    format="MM/DD/YYYY"
                    value={formik.values.date}
                    onChange={(value) => {
                      formik.setFieldValue("date", value);
                    }}
                  />

                  {formik.touched.date && formik.errors.date && (
                    <span className="text-error text-xs">{formik.errors.date}</span>
                  )}
                </Form.Item>
              </div>
              <div className="flex justify-between mb-4">
                <Form.Item
                  label="Select Certifier"
                  name="certifier"
                  className="w-72"
                >
                  <Select
                    id="certifier"
                    placeholder="Select Certifier"
                    allowClear
                    showSearch
                    name="certifier.name"
                    value={formik.values.certifier.name}
                    loading={isCertifiersLoading}
                    onChange={(value) => {
                      let selectedCertifier = { userAddress: "" };
                      if (value) {
                        selectedCertifier = certifiers.find(
                          (e) => e.commonName === value
                        );
                      }
                      formik.setFieldValue("certifier.name", value);
                      formik.setFieldValue(
                        "certifier.address",
                        selectedCertifier.userAddress
                      );
                      formik.setFieldTouched("certifier.name", false, false);
                    }}
                  >
                    {certifiers.map((e, index) => (
                      <Option value={e.commonName} key={index}>
                        {e.commonName}
                      </Option>
                    ))}
                  </Select>

                  {getIn(formik.touched, "certifier.name") &&
                    getIn(formik.errors, "certifier.name") && (
                      <span className="text-error text-xs">
                        {getIn(formik.errors, "certifier.name")}
                      </span>
                    )}
                </Form.Item>
                <Form.Item
                  label="Event Type"
                  name="eventType"
                  className="w-72"
                >
                  <Select
                    id="event-type"
                    placeholder="Select Event Type"
                    allowClear
                    showSearch
                    name="eventType.name"
                    disabled={false}
                    loading={isEventTypesLoading}
                    value={formik.values.eventType.name}
                    onChange={(value) => {
                      let selectedEventType = { address: "" };
                      if (value) {
                        selectedEventType = eventTypes.find(
                          (e) => e.name === value
                        );
                      }
                      formik.setFieldValue("eventType.name", value);
                      formik.setFieldValue(
                        "eventType.address",
                        selectedEventType.address
                      );
                      formik.setFieldTouched("eventType.name", false, false);
                    }}
                  >
                    {eventTypes.map((e, index) => {
                      return (
                        <Option value={e.name} key={index}>
                          {decodeURIComponent(e.name)}
                        </Option>
                      );
                    })}
                  </Select>
                  {getIn(formik.touched, "eventType.name") &&
                    getIn(formik.errors, "eventType.name") && (
                      <span className="text-error text-xs">
                        {getIn(formik.errors, "eventType.name")}
                      </span>
                    )}
                </Form.Item>
              </div>
              <Form.Item
                label="Summary"
                name="summary"
              >
                <TextArea
                  rows={5}
                  name="summary"
                  placeholder="Enter summary"
                  value={formik.values.summary}
                  onChange={formik.handleChange}
                />
                {formik.touched.summary && formik.errors.summary && (
                  <span className="text-error text-xs">
                    {formik.errors.summary}
                  </span>
                )}
              </Form.Item>

              <Row className="flex-nowrap justify-between items-center mt-4">
                <div>Serial Numbers</div>
                <div className="flex justify-start">
                  <div className="flex items-center" onClick={downloadSample}>
                    <DownloadOutlined className="text-primary text-sm font-medium cursor-pointer hover:text-primaryHover" />
                    <div className="text-primary ml-2 text-xs font-medium cursor-pointer hover:text-primaryHover">
                      Download Sample CSV
                    </div>
                  </div>
                  <Upload
                    onChange={uploadCSV}
                    accept=".csv"
                    customRequest={() => { }}
                    showUploadList={false}
                  >
                    <div className="ml-8 flex items-center">
                      <PaperClipOutlined className="text-primary text-sm font-medium cursor-pointer hover:text-primaryHover" />
                      <div className="text-primary ml-2 text-xs font-medium cursor-pointer hover:text-primaryHover">
                        Upload CSV
                      </div>
                    </div>
                  </Upload>
                </div>
              </Row>
              <Form.Item name="serialNumbers">
                <TextArea
                  label="serialNumbers"
                  rows={4}
                  disabled={true}
                  placeholder="Upload serial numbers using upload CSV option"
                  value={formik.values.serialNumber.serialNumStr}
                />
                {getIn(formik.touched, "serialNumber.serialNumStr") &&
                  getIn(formik.errors, "serialNumber.serialNumStr") && (
                    <span className="text-error text-xs">
                      {getIn(formik.errors, "serialNumber.serialNumStr")}
                    </span>
                  )}
              </Form.Item>
            </div>
          </Form>
          <Divider className="mb-0" /></>)}
      </Modal>
      {uploadErr && openToast("bottom")}
    </>
  );
};

export default CreateEventModal;
