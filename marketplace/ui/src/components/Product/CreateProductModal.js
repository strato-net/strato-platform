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
    image: null,
    name: "",
    category: {
      name: null,
      address: "",
    },
    subCategory: {
      name: null,
      address: "",
    },
    manufacturer: "",
    unitofmeasurement: {
      name: null,
      value: "",
    },
    leastSellableUnit: "",
    description: "",
    active: true,
    userUniqueProductCode:""
  };

  const formik = useFormik({
    initialValues: initialValues,
    validationSchema: schema,
    onSubmit: function (values, onSubmitProps) {
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

  const handleCancelPreview = () => {
    setPreviewOpen(false);
  };

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
            className="w-40"
            id="create-product-button"
            key="submit"
            type="primary"
            onClick={formik.handleSubmit}
            disabled={disabled}
          >
            {disabled ? <Spin /> : "Create Product"}
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
        {/* Inside the form I will have 4 sections to fill out titled Membership, Pricing, Services, and Documents. Each section will have different form items.
          Membership Form.Items: Membership Name, Category(dropdown), location, start date, end date, company Name, website, contact email, photos (multiple photo upload), and description
          Pricing Form.Items: price, quantity
          Services Form.Items: service name, description, number of uses, non member price, member price, (add service button)
          Documents Form.Items: upload document, list of uploaded documents.
        */}
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
                  <Select.Option key={category.id} value={category.id}>
                    {category.name}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
            <Form.Item label="Location" name="location">
              <Input
                id="location"
                name="location"
                type="text"
                placeholder="Location"
                onChange={formik.handleChange}
                value={formik.values.location}
                className="w-10/12"
              />
            </Form.Item>
            <Form.Item label="Start Date" name="startDate">
              <DatePicker
                id="startDate"
                name="startDate"
                placeholder="Start Date"
                onChange={(value) => {
                  formik.setFieldValue("startDate", value);
                }}
                value={formik.values.startDate}
                className="w-10/12"
              />
            </Form.Item>
            <Form.Item label="End Date" name="endDate">
              <DatePicker
                id="endDate"
                name="endDate"
                placeholder="End Date"
                onChange={(value) => {
                  formik.setFieldValue("endDate", value);
                }}
                value={formik.values.endDate}
                className="w-10/12"
              />
            </Form.Item>
            <Form.Item label="Company Name" name="companyName">
              <Input
                id="companyName"
                name="companyName"
                type="text"
                placeholder="Company Name"
                onChange={formik.handleChange}
                value={formik.values.companyName}
                className="w-10/12"
              />
            </Form.Item>
            <Form.Item label="Website" name="website">
              <Input
                id="website"
                name="website"
                type="text"
                placeholder="Website"
                onChange={formik.handleChange}
                value={formik.values.website}
                className="w-10/12"
              />
            </Form.Item>
            <Form.Item label="Contact Email" name="contactEmail">
              <Input
                id="contactEmail"
                name="contactEmail"
                type="text"
                placeholder="Contact Email"
                onChange={formik.handleChange}
                value={formik.values.contactEmail}
                className="w-10/12"
              />
            </Form.Item>
          </div>
          <Form.Item label="Photos" name="photos">
            <div className="flex flex-row flex-nowrap">
              <Upload
                id="photos"
                name="photos"
                onChange={handleImageChange}
                fileList={imageList}
                listType="picture-card"
                customRequest={() => {}}
                style={{ display: "none" }}
                accept="image/*"
                beforeUpload={beforeUpload}
                onPreview={handlePreview}
                maxCount={10}
              >
                {imageList.length >= 10 ? null : uploadButton}
              </Upload>
              <Modal
                open={previewOpen}
                title={previewTitle}
                footer={null}
                onCancel={handleCancelPreview}
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
            <Form.Item label="Price" name="price">
              <InputNumber
                id="price"
                name="price"
                type="number"
                min={1}
                addonBefore="$"
                value={formik.values.price}
                onChange={(value) => {
                  formik.setFieldValue("price", value);
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
            <div className="grid grid-cols-5" key={index}>
              <Form.Item label="Service Name" name={`serviceName${index}`}>
                <Input
                  id={`serviceName${index}`}
                  name={`serviceName${index}`}
                  type="text"
                  placeholder="Service Name"
                  onChange={formik.handleChange}
                  value={formik.values[`serviceName${index}`]}
                  className="w-10/12"
                />
              </Form.Item>
              <Form.Item
                label="Service Description"
                name={`serviceDescription${index}`}
              >
                <Input.TextArea
                  id={`serviceDescription${index}`}
                  name={`serviceDescription${index}`}
                  type="text"
                  placeholder="Service Description"
                  onChange={formik.handleChange}
                  value={formik.values[`serviceDescription${index}`]}
                  className="w-10/12"
                />
              </Form.Item>
              <Form.Item label="Number of Uses" name={`numberOfUses${index}`}>
                <InputNumber
                  id={`numberOfUses${index}`}
                  name={`numberOfUses${index}`}
                  type="number"
                  min={1}
                  value={formik.values[`numberOfUses${index}`]}
                  onChange={(value) => {
                    formik.setFieldValue(`numberOfUses${index}`, value);
                  }}
                  className="w-10/12"
                />
              </Form.Item>
              <Form.Item
                label="Non-Member Price"
                name={`nonMemberPrice${index}`}
              >
                <InputNumber
                  id={`nonMemberPrice${index}`}
                  name={`nonMemberPrice${index}`}
                  type="number"
                  min={1}
                  addonBefore="$"
                  value={formik.values[`nonMemberPrice${index}`]}
                  onChange={(value) => {
                    formik.setFieldValue(`nonMemberPrice${index}`, value);
                  }}
                  className="w-10/12"
                />
              </Form.Item>
              <Form.Item label="Member Price" name={`memberPrice${index}`}>
                <InputNumber
                  id={`memberPrice${index}`}
                  name={`memberPrice${index}`}
                  type="number"
                  min={1}
                  addonBefore="$"
                  value={formik.values[`memberPrice${index}`]}
                  onChange={(value) => {
                    formik.setFieldValue(`memberPrice${index}`, value);
                  }}
                  className="w-10/12"
                />
              </Form.Item>
              <Button
                className="w-10/12 self-center"
                type="primary"
                icon={<MinusOutlined />}
                onClick={() => {
                  removeServiceRow();
                }}
              >
              </Button>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-1">
          <Typography.Title level={5}>Documents</Typography.Title>
          <Form.Item label="Documents" name="documents" className="w-10/12">
            <div className="flex flex-row flex-nowrap">
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
            </div>
          </Form.Item>
        </div>
      </Form>
      {/* <Form layout="vertical" className="mt-5">
        <div className="flex w-full">
            <Form.Item label="Upload Image" name="image">
              <div className="w-48 h-48 p-4 border-secondryD border rounded flex flex-col justify-around">
                {selectedImage ? (
                  <div className="h-20">
                    <img
                      alt="Product"
                      src={selectedImage}
                      style={{ width: "100%", height: "100%" }}
                    />
                    <br />
                  </div>
                ) : (
                  <PictureOutlined className="text-7xl text-primary opacity-10" />
                )}
                <Upload
                  onChange={(e) => {
                    setSelectedImage(URL.createObjectURL(e.file.originFileObj));
                    formik.setFieldValue("image", e.file.originFileObj);
                  }}
                  customRequest={() => { }}
                  style={{ display: "none" }}
                  accept="image/png, image/jpeg"
                  maxCount={1}
                  showUploadList={false}
                  beforeUpload={beforeUpload}
                >
                  <div className="text-primary border border-primary rounded px-4 py-2 text-center hover:text-white hover:bg-primary cursor-pointer">
                    Browse
                  </div>
                </Upload>
              </div>

              <div className="flex items-start">
                <p className="mt-1 text-xs italic font-medium ">Note:</p>
                <p className="mt-1 text-xs italic ml-1 mr-4">
                  use jpg, png format of size less than 1mb
                </p>
              </div>
              {formik.touched.image && formik.errors.image && (
                <span className="text-error text-xs">
                  {formik.errors.image}
                </span>
              )}
            </Form.Item>
          <div className="w-3/4 mb-3">
            <div className="flex justify-between ">
              <Form.Item label="Name" name="name" className="w-72">
                <Input
                  label="name"
                  name="name"
                  placeholder="Enter Name"
                  value={formik.values.name}
                  onChange={formik.handleChange}
                />
                {formik.touched.name && formik.errors.name && (
                  <span className="text-error text-xs">
                    {formik.errors.name}
                  </span>
                )}
              </Form.Item>
              <Form.Item label="Category" className="w-72">
                <Select
                  id="category"
                  placeholder="Select Category"
                  showSearch
                  allowClear
                  name="category.name"
                  value={formik.values.category.name}
                  onChange={(value) => {
                    formik.setFieldValue("category.name", value);
                    formik.setFieldValue("subCategory.name", null);
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
            <div className="flex justify-between mt-4">
              <Form.Item
                label="Sub Category"
                name="subCategory"
                className="w-72"
              >
                <Select
                  id="subCategory"
                  showSearch
                  placeholder="Select Sub Category"
                  allowClear
                  name="subCategory.name"
                  value={formik.values.subCategory.name}
                  onChange={(value) => {
                    formik.setFieldValue("subCategory.name", value);
                  }}
                >
                  {categorys.map((category) =>
                    category.name === formik.values.category.name ? category.subCategories.map((e, index) => (
                      <Option value={e.name} key={index}>
                        {e.name}
                      </Option>
                    )) : null
                  )}
                </Select>
                {getIn(formik.touched, "subCategory.name") &&
                  getIn(formik.errors, "subCategory.name") && (
                    <span className="text-error text-xs">
                      {getIn(formik.errors, "subCategory.name")}
                    </span>
                  )}
              </Form.Item>
              <Form.Item
                label="Manufacturer"
                name="manufacturer"
                className="w-72"
              >
                <Input
                  label="manufacturer"
                  placeholder="Enter Manufacturer"
                  name="manufacturer"
                  value={formik.values.manufacturer}
                  onChange={formik.handleChange}
                />
                {formik.touched.manufacturer && formik.errors.manufacturer && (
                  <span className="text-error text-xs">
                    {formik.errors.manufacturer}
                  </span>
                )}
              </Form.Item>
            </div>
            <div className="flex justify-between mt-4 ">
              <Form.Item
                label="Unit of Measurement "
                name="unitofmeasurement "
                className="w-72"
              >
                <Select
                  id="unitofmeasurement"
                  placeholder="Select Unit of Measurement "
                  allowClear
                  name="unitofmeasurement.name"
                  value={formik.values.unitofmeasurement.name}
                  onChange={(value) => {
                    let selectedUOM = unitOfMeasures.find(u => u.value === value);
                    formik.setFieldValue("unitofmeasurement.name", selectedUOM.name);
                    formik.setFieldValue("unitofmeasurement.value", value);
                  }}
                >
                  {unitOfMeasures.map((e, index) => (
                    <Option value={e.value} key={index}>
                      {e.name}
                    </Option>
                  ))}
                </Select>
                {getIn(formik.touched, "unitofmeasurement.name") &&
                  getIn(formik.errors, "unitofmeasurement.name") && (
                    <span className="text-error text-xs">
                      {getIn(formik.errors, "unitofmeasurement.name")}
                    </span>
                  )}
              </Form.Item>
              <Form.Item
                label="Least Sellable Unit"
                name="leastSellableUnit"
                className="w-72"
              >
                <Input
                  label="leastSellableUnit"
                  name="leastSellableUnit"
                  value={formik.values.leastSellableUnit}
                  onChange={formik.handleChange}
                  placeholder="Enter Least Sellable Unit"
                />
                {formik.touched.leastSellableUnit &&
                  formik.errors.leastSellableUnit && (
                    <span className="text-error text-xs">
                      {formik.errors.leastSellableUnit}
                    </span>
                  )}
              </Form.Item>
            </div>
            <Form.Item label="Description" name="description" className="mt-4">
              <TextArea
                label="description"
                placeholder="Enter Description"
                name="description"
                value={formik.values.description}
                onChange={formik.handleChange}
              />
              {formik.touched.description && formik.errors.description && (
                <span className="text-error text-xs">
                  {formik.errors.description}
                </span>
              )}
            </Form.Item>
            <div className="flex justify-between mt-4 items-center">
            <Form.Item label="Active" name="active">
              <Radio.Group
                value={formik.values.active}
                onChange={formik.handleChange}
                name="active"
              >
                <Radio value={true}>Yes</Radio>
                <Radio value={false}>No</Radio>
              </Radio.Group>

              {formik.touched.active && formik.errors.active && (
                <span className="text-error text-xs">
                  {formik.errors.active}
                </span>
              )}
            </Form.Item>
              <Form.Item
                label="Unique Product Code"
                name="userUniqueProductCode"
                className="w-72"
              >
                <Input
                  label="userUniqueProductCode"
                  placeholder="Enter Unique Product Code"
                  name="userUniqueProductCode"
                  value={formik.values.userUniqueProductCode}
                  onChange={formik.handleChange}
                />
                {formik.touched.userUniqueProductCode && formik.errors.userUniqueProductCode && (
                  <span className="text-error text-xs">
                    {formik.errors.userUniqueProductCode}
                  </span>
                )}
              </Form.Item>
            </div>
           
          </div>
        </div>
      </Form> */}
    </Modal>
  );
};

export default CreateProductModal;
