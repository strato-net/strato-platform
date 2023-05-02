import React, { useState, useEffect } from "react";
import { useFormik, getIn } from "formik";
import { DownloadOutlined, PaperClipOutlined } from "@ant-design/icons";
import { Form, Modal, Select, Button, DatePicker, Radio, Row, Upload, notification, Spin, Divider, Typography } from "antd";
import TextArea from "antd/es/input/TextArea";
import getSchema from "./EventSchema";
import { downloadSample } from "../../helpers/utils";
import { usePapaParse } from "react-papaparse";
//event types
import { actions as EventTypeActions } from "../../contexts/eventType/actions";
import { useEventTypeDispatch, useEventTypeState } from "../../contexts/eventType";
//events
import { actions as eventActions } from "../../contexts/event/actions";
import { useEventState, useEventDispatch } from "../../contexts/event";
//items
import { actions as ItemActions } from "../../contexts/item/actions";
import { useItemDispatch, useItemState } from "../../contexts/item";
//certifier
import { actions as certifierActions } from "../../contexts/certifier/actions";
import { useCertifiersDispatch, useCertifiersState } from "../../contexts/certifier";
import dayjs from 'dayjs';

const { Option } = Select;
const { Text } = Typography;

const AddEventModal = ({ open, handleCancel, inventoryId, productId }) => {
  const [uploadErr, setUploadErr] = useState("");
  const [api, contextHolder] = notification.useNotification();
  const { readString } = usePapaParse();
  const schema = getSchema();
  const [radioValue, setRadioValue] = useState(1);

  const eventsDispatch = useEventDispatch();

  const eventTypeDispatch = useEventTypeDispatch();
  const {
    isEventTypesLoading,
    eventTypes
  } = useEventTypeState();

  const {
    isCreateEventSubmitting
  } = useEventState();


  //items
  const itemsDispatch = useItemDispatch();
  const {
    items,
    isitemDetailsLoading
  } = useItemState();

  useEffect(() => {
    ItemActions.fetchItem(itemsDispatch, "", 0, inventoryId);
  }, []);

   //certifier
   const certifierDispatch = useCertifiersDispatch();
   const {
     isCertifiersLoading,
     certifiers
   } = useCertifiersState();

  useEffect(() => {
    let tempNumbers = "";
    items.map(elem => {
      if (elem.serialNumber) {
        tempNumbers += elem.serialNumber + ",";
      }
    });
    let tempArr = items.map(elem => elem.serialNumber);
    tempNumbers = tempNumbers.substring(0, tempNumbers.length - 1);
    formik.setFieldValue("serialNumber.serialNumStr", tempNumbers);
    formik.setFieldValue("serialNumber.serialNumArr", tempArr);

  }, [items]);

  const formik = useFormik({
    initialValues: {
      eventType: {
        name: null,
        address: "",
      },
      date: "",
      certifier: {
        name: null,
        address: "",
      },
      summary: "",
      serialNumber: {
        serialNumStr: "",
        serialNumArr: [],
      },
    },
    validationSchema: schema,
    onSubmit: function (values) {
     
      handleFormSubmit(values);
    },
  });

  const handleFormSubmit = async (values) => {
    const body = {
      eventTypeId: values.eventType.address,
      productId: productId,//
      date: dayjs(values.date).unix(),
      certifier: values.certifier.address,
      summary: encodeURIComponent(values.summary),
      serialNumbers: values.serialNumber.serialNumArr
    };
   
    let isDone = await eventActions.createEvent(eventsDispatch, body);
    if (isDone) {
      handleCancel();
    }
  };

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

  const handleChange = (e) => {
    setRadioValue(e.target.value);
  }

  return (
    <>
      {contextHolder}
      <Modal
        open={open}
        centered
        onCancel={handleCancel}
        width={673}
        title={
          <Text className="block text-center text-xl font-semibold">
            Add Event
          </Text>
        }
        footer={[
          <Row className="justify-center">
            <Button
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
        {isEventTypesLoading || isitemDetailsLoading ? (
          <div className="h-96 flex justify-center items-center">
            <Spin size="large" />
          </div>
        ) : (<>
          <Form layout="vertical" className="mt-5" onSubmit={formik.handleSubmit}>
            <div className="w-full mb-3">
              <div className="flex justify-between mb-4">
                <Form.Item
                  label="Event Type"
                  name="eventType"
                  className="w-72"
                >
                  <Select
                    placeholder="Select Event Type"
                    allowClear
                    showSearch
                    id="eventType"
                    name="eventType.name"
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
                <Form.Item
                  label="Select Certifier"
                  name="certifier"
                  className="w-72"
                >
                  <Select
                    placeholder="Select Certifier"
                    allowClear
                    showSearch
                    id="certifier"
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

              </div>
              <div className="flex justify-between mb-4">
                <Form.Item
                  label="Select Date"
                  name="date"
                  className="w-72"
                >
                  <DatePicker
                    placeholder="Select Date"
                    allowClear
                    id="date-picker"
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
              <Row className="flex-nowrap justify-between items-end mt-2">
                <Form.Item className="mt-4">
                  <Radio.Group
                    value={radioValue}
                    onChange={handleChange}
                    className="flex flex-col"
                  >
                    <Radio value={1} className="mb-4">Apply to all Items</Radio>
                    <Radio value={2} className="mb-2">Upload Serial Numbers</Radio>
                  </Radio.Group>
                </Form.Item>
                <div className="flex justify-start mb-2">
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
                    disabled={radioValue === 1}
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
                  label="serialNumber"
                  rows={4}
                  disabled={true}
                  placeholder="Upload serial numbers using upload CSV option "
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
          </Form></>)}
      </Modal>
      {uploadErr && openToast("bottom")}
    </>
  );
};

export default AddEventModal;
