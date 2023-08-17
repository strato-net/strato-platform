import React, { useState } from "react";
import { useFormik } from "formik";
import {
  Form,
  Modal,
  Input,
  InputNumber,
  Select,
  Button,
  Upload,
  Spin,
  notification,
  Typography,
} from "antd";
import { PlusOutlined, InboxOutlined, MinusOutlined } from "@ant-design/icons";
// import getSchema from "./ProductSchema";

//sub-categories
import { actions } from "../../contexts/membership/actions";
import { useMembershipDispatch, useMembershipState } from "../../contexts/membership";

const { Dragger } = Upload;

const CreateMembershipModal = ({
  open,
  handleCancel,
  categorys,
}) => {
  // const schema = getSchema();
  const dispatch = useMembershipDispatch();
  const [previewImage, setPreviewImage] = useState("");
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [imageList, setImageList] = useState([]);
  const [fileList, setFileList] = useState([]);

  const { isCreateProductSubmitting, isuploadImageSubmitting } =
  useMembershipState();

  const initialValues = {
    name: "",
    category: "",
    duration: "",
    additionalInformation: "",
    images: [],
    description: "",
    yearlyPrice: "",
    monthlyPrice: "",
    quantity: "",
    services: [
      {
        serviceName: "",
        numberOfUses: "",
        memberPrice: null,
        percentDiscount: null,
      },
    ],
    documents: [],
  };

  const formik = useFormik({
    initialValues: initialValues,
    // validationSchema: schema,
    setFieldValue: (field, value) => {
      formik.setFieldValue(field, value);
    },
    onSubmit: function (values) {
      handleCreateFormSubmit(values);
    },
    enableReinitialize: true,
  });

  const getBase64 = (file) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result);
      reader.onerror = (error) => reject(error);
    });

  const handlePreview = async (file) => {
    if (!file.url && !file.preview) {
      file.preview = await getBase64(file.originFileObj);
    }
    setPreviewImage(file.url || file.preview);
    setPreviewOpen(true);
    setPreviewTitle(
      file.name || file.url.substring(file.url.lastIndexOf("/") + 1)
    );
  };

  const handleImageChange = ({ fileList }) => {
    setImageList(fileList);
    formik.setFieldValue("images", fileList);
  };

  const uploadButton = (
    <div
      style={{ display: "inline-block", verticalAlign: "top", marginRight: 8 }}
    >
      <PlusOutlined />
      <div>Upload</div>
    </div>
  );

  const addServiceRow = () => {
    const updatedServices = [...formik.values.services];
    updatedServices.push({
      serviceName: "",
      numberOfUses: "",
      memberPrice: "",
      percentDiscount: "",
    });
    formik.setFieldValue("services", updatedServices);
  };

  const removeServiceRow = (indexToRemove) => {
    const updatedServices = [...formik.values.services];
    updatedServices.splice(indexToRemove, 1);
    formik.setFieldValue("services", updatedServices);
  };

  const handleMemberPriceChange = (index, value) => {
    const updatedServices = [...formik.values.services];
    updatedServices[index] = {
      ...updatedServices[index],
      memberPrice: value,
      percentDiscount: null, // Clear discount
    };
    formik.setFieldValue("services", updatedServices);
  };

  const handlePercentDiscountChange = (index, value) => {
    const updatedServices = [...formik.values.services];
    updatedServices[index] = {
      ...updatedServices[index],
      percentDiscount: value,
      memberPrice: null, // Clear member price
    };
    formik.setFieldValue("services", updatedServices);
  };

  const handleDocumentChange = (info) => {
    let fileList = [...info.fileList];
    fileList = fileList.slice(-info.fileList.length);
    setFileList(fileList);
    formik.setFieldValue("documents", fileList);
  };

  const props = {
    name: "file",
    multiple: true,
    onChange: handleDocumentChange,
    onDrop(e) {
      console.log("Dropped files", e.dataTransfer.files);
    },
    fileList: fileList,
    accept: ".pdf, .doc, .docx .txt, .png, .jpg, .jpeg, .webp",
    // If we don't use the action parameter, antd can get errors uploading the file. Set before upload to false to prevent this behavior.
    beforeUpload: () => {
      return false;
    },
  };

  const handleCreateFormSubmit = async (values) => {
    console.log("formik", formik.values);
    console.log("values", values);
    
    // TODO: Update this data to match whats needed in the backend. 
    // Might have to send images and documents separately.
  };

  const disabled = isCreateProductSubmitting || isuploadImageSubmitting;

  const closeModal = () => {
    handleCancel();
  };

  function beforeUpload() {
    return false;
  }

  const [api, contextHolder] = notification.useNotification();

  const openToast = (placement, message) => {
    api.error({
      message: message,
      onClose: actions.resetMessage(dispatch),
      placement,
      key: 2,
    });
  };

  return (
    <Modal
      open={open}
      centered
      onCancel={closeModal}
      width={1000}
      footer={[
        <div className="flex justify-center">
          <Button
            id="create-product-button"
            key="submit"
            type="primary"
            onClick={formik.handleSubmit}
            disabled={disabled}
          >
            {disabled ? <Spin /> : "Create Membership"}
          </Button>
        </div>,
      ]}
    >
      {contextHolder}
      <h1
        id="modal-title"
        className="text-center font-semibold text-lg text-primaryB"
      >
        Create Membership
      </h1>
      <hr className="text-secondryD mt-3" />
      <Form layout="vertical" className="mt-5">
        <div className="flex flex-col mb-7">
          <Typography.Title level={5}>Membership</Typography.Title>
          <div className="grid grid-cols-5 mb-6">
            <Form.Item label="Membership Name" name="name">
              <Input
                id="name"
                name="name"
                type="text"
                placeholder="Membership Name"
                onChange={(e) => {
                  formik.setFieldValue("name", e.target.value);
                }}
                value={formik.values.name}
                className="w-10/12"
              />
            </Form.Item>
            <Form.Item label="Category" name="category" className="w-10/12">
              <Select
                id="category"
                name="category"
                placeholder="Select Category"
                onChange={(value) => {
                  formik.setFieldValue("category", value);
                }}
                value={formik.values.category}
              >
                {categorys.map((category) => (
                  <Select.Option key={category.name} value={category.id}>
                    {category.name}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item label="Duration (Months)" name="duration">
              <InputNumber
                id="duration"
                name="duration"
                type="number"
                min={0}
                value={formik.values.duration}
                onChange={(value) => {
                  formik.setFieldValue("duration", value);
                }}
                className="w-10/12"
              />
            </Form.Item>
            <Form.Item
              label="Additional Information"
              name="additionalInformation"
              className="col-span-2"
            >
              <Input.TextArea
                id="additionalInformation"
                name="additionalInformation"
                type="text"
                onChange={(e) => {
                  formik.setFieldValue("additionalInformation", e.target.value);
                }}
                value={formik.values.additionalInformation}
                className=""
              />
            </Form.Item>
          </div>

          <Form.Item label="Images" name="images">
            <Upload
              id="images"
              listType="picture-card"
              multiple={true}
              fileList={imageList}
              onPreview={handlePreview}
              onChange={handleImageChange}
              beforeUpload={beforeUpload}
              accept="image/png, image/webp, image/jpeg"
            >
              {imageList.length >= 10 ? null : uploadButton}
            </Upload>
            <Modal
              open={previewOpen}
              title={previewTitle}
              footer={null}
              onCancel={() => setPreviewOpen(false)}
            >
              <img
                alt="example"
                style={{
                  width: "100%",
                }}
                src={previewImage}
              />
            </Modal>
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input.TextArea
              id="description"
              name="description"
              type="text"
              placeholder="Description"
              onChange={(e) => {
                formik.setFieldValue("description", e.target.value);
              }}
              value={formik.values.description}
              className=""
            />
          </Form.Item>
        </div>
        <div className="flex flex-col mb-7">
          <Typography.Title level={5}>Pricing</Typography.Title>
          <div className="grid grid-cols-5">
            <Form.Item label="Yearly Price" name="price">
              <InputNumber
                id="yearlyPrice"
                name="yearlyPrice"
                type="number"
                min={0}
                addonBefore="$"
                value={formik.values.yearlyPrice}
                onChange={(value) => {
                  formik.setFieldValue("yearlyPrice", value);
                }}
                className="w-10/12"
              />
            </Form.Item>
            <Form.Item label="Monthly Price" name="monthlyPrice">
              <InputNumber
                id="monthlyPrice"
                name="monthlyPrice"
                type="number"
                min={0}
                addonBefore="$"
                value={formik.values.monthlyPrice}
                onChange={(value) => {
                  formik.setFieldValue("monthlyPrice", value);
                }}
                className="w-10/12"
              />
            </Form.Item>
            <Form.Item label="Quantity" name="quantity">
              <InputNumber
                id="quantity"
                name="quantity"
                type="number"
                min={0}
                value={formik.values.quantity}
                onChange={(value) => {
                  formik.setFieldValue("quantity", value);
                }}
                className="w-10/12"
              />
            </Form.Item>
          </div>
        </div>
        <div className="flex flex-col mb-7">
          <Typography.Title level={5}>Services</Typography.Title>
          <Button
            className="w-80"
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => {
              addServiceRow();
            }}
          >
            Add Service
          </Button>

          {formik.values.services.map((service, index) => (
            <div className="grid grid-cols-6 mt-3" key={`row_${index}`}>
              <Form.Item
                label="Service Name"
                name={`serviceName_${index}`}
                className="col-span-2 mr-7"
                key={`serviceName_${index}`}
                value={formik.values.services[index].serviceName}
              >
                <Select
                  id={`serviceName_${index}`}
                  name={`serviceName_${index}`}
                  placeholder="Select Service"
                  onChange={(value) => {
                    const updatedServices = [...formik.values.services];
                    updatedServices[index] = {
                      ...updatedServices[index],
                      serviceName: value,
                    };
                    formik.setFieldValue("services", updatedServices);
                  }}
                  value={service.serviceName}
                >
                  {categorys.map((category) => (
                    <Select.Option key={category.id} value={category.name}>
                      {category.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item
                label="Number of Uses"
                name={`numberOfUses_${index}`}
                key={`numberOfUses_${index}`}
                value={service.numberOfUses}
              >
                <InputNumber
                  id={`numberOfUses_${index}`}
                  name={`numberOfUses_${index}`}
                  type="number"
                  min={0}
                  value={service.numberOfUses}
                  onChange={(value) => {
                    const updatedServices = [...formik.values.services];
                    updatedServices[index] = {
                      ...updatedServices[index],
                      numberOfUses: value,
                    };
                    formik.setFieldValue("services", updatedServices);
                  }}
                  className="w-10/12"
                />
              </Form.Item>
              <Form.Item
                label="Member Price"
                name={`memberPrice_${index}`}
                key={`memberPrice_${index}`}
              >
                <InputNumber
                  id={`memberPrice_${index}`}
                  name={`memberPrice_${index}`}
                  type="number"
                  min={0}
                  addonBefore="$"
                  value={service.memberPrice}
                  onChange={(value) => {
                    handleMemberPriceChange(index, value);
                  }}
                  className="w-10/12"
                />
              </Form.Item>
              <Form.Item
                label="Percent Discount"
                name={`percentDiscount_${index}`}
                key={`percentDiscount_${index}`}
              >
                <InputNumber
                  id={`percentDiscount_${index}`}
                  name={`percentDiscount_${index}`}
                  type="number"
                  min={0}
                  addonBefore="%"
                  value={service.percentDiscount}
                  onChange={(value) => {
                    handlePercentDiscountChange(index, value);
                  }}
                  className="w-10/12"
                />
              </Form.Item>

              <Button
                className="w-10/12 self-end"
                key={`removeService_${index}`}
                type="primary"
                icon={<MinusOutlined />}
                onClick={() => {
                  removeServiceRow();
                }}
              ></Button>
            </div>
          ))}
        </div>
        <div className="flex flex-col">
          {/* TODO: make sure this works for uploading multiple files */}
          <Typography.Title level={5}>Documents</Typography.Title>
          <Form.Item label="Documents" name="documents">
            <Dragger {...props}>
              <p className="ant-upload-drag-icon">
                <InboxOutlined />
              </p>
              <p className="ant-upload-text">
                Click or drag file to this area to upload
              </p>
              <p className="ant-upload-hint">
                Support for a single or bulk upload.
              </p>
            </Dragger>
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
};

export default CreateMembershipModal;
