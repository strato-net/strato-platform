import React, { useState } from "react";
import { useFormik, getIn } from "formik";
import {
  Form,
  Modal,
  Input,
  InputNumber,
  Select,
  DatePicker,
  Button,
  Upload,
  message,
  Spin,
  notification,
  Typography,
} from "antd";
import TextArea from "antd/es/input/TextArea";
import {
  PictureOutlined,
  PlusOutlined,
  InboxOutlined,
  MinusOutlined,
} from "@ant-design/icons";
import getSchema from "./ProductSchema";

//sub-categories
import { actions } from "../../contexts/product/actions";
import { useProductDispatch, useProductState } from "../../contexts/product";
import { unitOfMeasures } from "../../helpers/constants";

const { Option } = Select;
const { Dragger } = Upload;

const CreateProductModal = ({
  open,
  handleCancel,
  categorys,
  resetPage,
  page,
  debouncedSearchTerm,
}) => {
  const schema = getSchema();
  // const [selectedImage, setSelectedImage] = useState(null);
  const dispatch = useProductDispatch();
  const [previewImage, setPreviewImage] = useState("");
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [imageList, setImageList] = useState([]);
  const [serviceRows, setServiceRows] = useState(0);

  const { isCreateProductSubmitting, isuploadImageSubmitting } =
    useProductState();

  const initialValues = {
    name: "",
    category: "",
    location: "",
    duration: "",
    website: "",
    contactEmail: "",
    photos: [],
    description: "",
    yearlyPrice: "",
    monthlyPrice: "",
    quantity: "",
    // These service fields are dynamic. They are added and removed by the user
    // Lets see if we need initial values or not
    // serviceName: "",
    // numberOfUses: "",
    // memberPrice: "",
    documents: [],
  };

  const formik = useFormik({
    initialValues: initialValues,
    validationSchema: schema,
    onSubmit: function (values, onSubmitProps) {
      console.log("values", values)
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
    formik.setFieldValue("image", fileList);
  };

  const uploadButton = (
    <div>
      <PlusOutlined />
      <div
        style={{
          marginTop: 8,
        }}
      >
        Upload
      </div>
    </div>
  );

  const addServiceRow = () => {
    setServiceRows(serviceRows + 1);
  };

  const removeServiceRow = () => {
    if (serviceRows > 0) {
      setServiceRows(serviceRows - 1);
    }
  };

  // These were used in the AntD example. Not sure if we need them for our upload
  // See action linkn below
  const props = {
    name: "file",
    multiple: true,
    action: "https://www.mocky.io/v2/5cc8019d300000980a055e76",
    onChange(info) {
      const { status } = info.file;
      if (status !== "uploading") {
        console.log(info.file, info.fileList);
      }
      if (status === "done") {
        message.success(`${info.file.name} file uploaded successfully.`);
      } else if (status === "error") {
        message.error(`${info.file.name} file upload failed.`);
      }
    },
    onDrop(e) {
      console.log("Dropped files", e.dataTransfer.files);
    },
  };

  const handleCreateFormSubmit = async (values) => {
    const formData = new FormData();
    formData.append("fileUpload", formik.values.image);
    let imageData = await actions.uploadImage(dispatch, formData);
    if (imageData) {
      const body = {
        productArgs: {
          name: encodeURIComponent(values.name),
          description: encodeURIComponent(values.description),
          manufacturer: encodeURIComponent(values.manufacturer),
          unitOfMeasurement: values.unitofmeasurement.value,
          leastSellableUnit: parseInt(values.leastSellableUnit),
          imageKey: imageData.imageKey,
          isActive: values.active,
          category: values.category.name,
          subCategory: values.subCategory.name,
          userUniqueProductCode: values.userUniqueProductCode,
        },
      };

      let isDone = await actions.createProduct(dispatch, body);

      if (isDone) {
        if (page === 1)
          actions.fetchProduct(dispatch, 10, 0, debouncedSearchTerm);
        resetPage(1);
        handleCancel();
      }
    }
  };

  const disabled = isCreateProductSubmitting || isuploadImageSubmitting;

  const closeModal = () => {
    handleCancel();
  };

  function beforeUpload(file) {
    const isJpgOrPng = file.type === "image/jpeg" || file.type === "image/png";
    if (!isJpgOrPng) {
      openToast("bottom", "Image must be of jpeg or png format");
    }
    const isLt1M = file.size / 1024 / 1024 < 1;
    if (!isLt1M) {
      openToast("bottom", "Cannot upload an image of size more than 1mb");
    }
    return isJpgOrPng && isLt1M;
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
                onChange={formik.handleChange}
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
                min={1}
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
                onChange={formik.handleChange}
                value={formik.values.additionalInformation}
                className=""
              />
            </Form.Item>
          </div>
          <Form.Item label="Photos" name="photos">
            <div className="grid grid-cols-8 grid-rows-1">
              <Upload
                id="images"
                listType="picture-card"
                fileList={imageList}
                onPreview={handlePreview}
                onChange={handleImageChange}
                beforeUpload={beforeUpload}
                className="margin-0 w-12/12"
              >
                {imageList.length >= 10 ? null : uploadButton}
              </Upload>
              <Modal
                open={previewOpen}
                title={previewTitle}
                footer={null}
                onCancel={handleCancel}
              >
                <img
                  alt="example"
                  style={{
                    width: "100%",
                  }}
                  src={previewImage}
                />
              </Modal>
            </div>
          </Form.Item>
          <Form.Item label="Description" name="description">
            <Input.TextArea
              id="description"
              name="description"
              type="text"
              placeholder="Description"
              onChange={formik.handleChange}
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
                min={1}
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
                min={1}
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
                min={1}
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

          {Array.from({ length: serviceRows }).map((_, index) => (
            <div className="grid grid-cols-6 mt-3" key={`row_${index}`} >
              <Form.Item label="Service Name" name={`serviceName_${index}`} className="col-span-2 mr-7" key={`serviceName_${index}`}>
                <Select
                  id={`serviceName_${index}`}
                  name={`serviceName_${index}`}
                  placeholder="Select Service"
                  onChange={(value) => {
                    formik.setFieldValue(`serviceName_${index}`, value);
                  }}
                  value={formik.values[`serviceName_${index}`]}
                  
                >
                  {/* TODO: Replace this with the services when they are added. */}
                  {categorys.map((category) => (
                    <Select.Option key={`service_${category.name}_${index}`} value={category.id}>
                      {category.name}
                    </Select.Option>
                  ))}
                </Select>
              </Form.Item>
              <Form.Item label="Number of Uses" name={`numberOfUses_${index}`} key={`numberOfUses_${index}`}>
                <InputNumber
                  id={`numberOfUses_${index}`}
                  name={`numberOfUses_${index}`}
                  type="number"
                  min={1}
                  value={formik.values[`numberOfUses_${index}`]}
                  onChange={(value) => {
                    formik.setFieldValue(`numberOfUses_${index}`, value);
                  }}
                  className="w-10/12"
                />
              </Form.Item>
              <Form.Item label="Member Price" name={`memberPrice_${index}`} key={`memberPrice_${index}`}>
                <InputNumber
                  id={`memberPrice_${index}`}
                  name={`memberPrice_${index}`}
                  type="number"
                  min={1}
                  addonBefore="$"
                  value={formik.values[`memberPrice_${index}`]}
                  onChange={(value) => {
                    formik.setFieldValue(`memberPrice_${index}`, value);
                  }}
                  className="w-10/12"
                />
              </Form.Item>
              <Form.Item label="Percent Discount" name={`percentDiscount_${index}`} key={`percentDiscount${index}`}>
                <InputNumber
                  id={`percentDiscount_${index}`}
                  name={`percentDiscount_${index}`}
                  type="number"
                  min={1}
                  addonBefore="%"
                  value={formik.values[`percentDiscount_${index}`]}
                  onChange={(value) => {
                    formik.setFieldValue(`percentDiscount_${index}`, value);
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
            <Form.Item label="Documents" name="documents" className="">
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

export default CreateProductModal;
