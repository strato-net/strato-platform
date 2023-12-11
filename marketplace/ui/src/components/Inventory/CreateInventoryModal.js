import React, { useEffect, useState } from "react";
import { useFormik, getIn } from "formik";
import { DownloadOutlined, PaperClipOutlined } from "@ant-design/icons";
import {
  Form,
  Modal,
  Input,
  InputNumber,
  Select,
  Tag,
  Radio,
  Button,
  Spin,
  Upload,
  notification,
} from "antd";
import {
  useInventoryDispatch,
  useInventoryState,
} from "../../contexts/inventory";
import { actions } from "../../contexts/inventory/actions";
import { Link } from "react-router-dom";
import TextArea from "antd/es/input/TextArea";
import getSchema from "./InventorySchema";
import { usePapaParse } from "react-papaparse";
import TagManager from "react-gtm-module";
import { CATEGORIES, PAYMENT_TYPE, unitOfMeasures, categoryInfo } from "../../helpers/constants";
import { PictureOutlined } from "@ant-design/icons";

const { Option } = Select;

const CreateInventoryModal = ({
  open,
  handleCancel,
  categorys,
  debouncedSearchTerm,
  resetPage,
  page,
}) => {
  const schema = getSchema();
  const dispatch = useInventoryDispatch();
  const { readString } = usePapaParse();
  const [api, contextHolder] = notification.useNotification();
  const [uploadErr, setUploadErr] = useState("");
  const { isCreateInventorySubmitting, isUploadImageSubmitting } =
    useInventoryState();
  const [selectedImage, setSelectedImage] = useState(null);
  const [clothingType, setClothingType] = useState(null);
  const [sizeOptions, setSizeOptions] = useState([]);

  const initialValues = {
    serialNumber: "",
    name: "",
    description: "",
    artist: "",
    source: "",
    leastSellableUnits: 1,
    unitOfMeasurement: {
      name: "TON",
      value: 1,
    },
    purity: "",
    units: 1,
    expirationPeriodInMonths: 1,
    brand: "",
    clothingType: null,
    images: null,
    price: 0,
    paymentTypes: [],
    category: "Art",
    size: null,
    skuNumber: null,
    condition: null,
    brand: null,
  };

  const formik = useFormik({
    initialValues: initialValues,
    validationSchema: schema,
    onSubmit: function (values) {
      handleCreateFormSubmit(values);
    },
    enableReinitialize: true,
  });

  function beforeUpload(file) {
    const isJpgOrPng = file.type === "image/jpeg" || file.type === "image/png";
    if (!isJpgOrPng) {
      setUploadErr("Image must be of jpeg or png format");
    }
    const isLt1M = file.size / 1024 / 1024 < 1;
    if (!isLt1M) {
      setUploadErr("Cannot upload an image of size more than 1mb");
    }
    return isJpgOrPng && isLt1M;
  }

  console.log(formik.errors);
  const handleCreateFormSubmit = async (values) => {
    const formData = new FormData();
    formData.append("fileUpload", values.images);

    let imageData = values.images
      ? await actions.uploadImage(dispatch, formData)
      : null;
    const body = {
      itemArgs: {
        serialNumber: values.serialNumber,
        name: values.name,
        description: values.description,
        images: imageData ? [imageData.imageKey] : [],
        price: values.price,
        paymentTypes: values.paymentTypes,
      },
    };

    const finalBody = (body) => {
      switch (values.category) {
        case "Art":
          return (body = {
            itemArgs: {
              ...body.itemArgs,
              artist: values.artist,
            },
          });
        case "Carbon":
          return (body = {
            itemArgs: {
              ...body.itemArgs,
              units: values.units,
            },
          });
        case "Clothing":
          return (body = {
            itemArgs: {
              ...body.itemArgs,
              clothingType: values.clothingType,
              skuNumber: values.skuNumber,
              size: values.size,
              condition: values.condition,
              brand: values.brand,
              units: values.units,
            },
          });
        case "Collectibles":
          return (body = {
            itemArgs: {
              ...body.itemArgs,
              condition: values.condition,
              units: values.units,
            },
          });
        case "Metals":
          return (body = {
            itemArgs: {
              ...body.itemArgs,
              source: values.source,
            }
          });
        case 'Membership':
          const selectedUOM = unitOfMeasures.find(u => u.value === values.unitOfMeasurement.value);
          
          return {
            ...body,
            itemArgs: {
              ...body.itemArgs,
              units: values.units,
              unitOfMeasurement: selectedUOM.value,
              leastSellableUnits: values.leastSellableUnits,
              units: values.units,
              expirationPeriodInMonths: values.expirationPeriodInMonths
              purity: values.purity
            }
          };
          
        default:
          break;
      }
    };

    window.LOQ = window.LOQ || [];
    window.LOQ.push([
      "ready",
      async (LO) => {
        // Track an event
        await LO.$internal.ready("events");
        LO.events.track("Create Inventory", {
          category: values.category.name,
          product: values.productName.name,
        });
      },
    ]);
    TagManager.dataLayer({
      dataLayer: {
        event: "create_item",
      },
    });

    let isDone = await actions.createItem(
      dispatch,
      finalBody(body),
      values.category
    );

    if (isDone) {
      if (page === 1)
        actions.fetchInventory(dispatch, 10, 0, debouncedSearchTerm);
      resetPage(1);
      handleCancel();
    }
  };

  const openToast = (placement) => {
    api.error({
      message: uploadErr,
      onClose: setUploadErr(""),
      placement,
      key: 1,
    });
  };

  const tagRender = (props) => {
    const { label, value, closable, onClose } = props;
    const onPreventMouseDown = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    return (
      <Tag
        onMouseDown={onPreventMouseDown}
        closable={closable}
        onClose={onClose}
        className="flex items-center mr-1"
      >
        {PAYMENT_TYPE[value].icon ? PAYMENT_TYPE[value].icon : <></>}
        <p className="ml-1">{label}</p>
      </Tag>
    );
  };

  const handleSelectAll = (value) => {
    if (value.includes(0)) {
      if (value.length === PAYMENT_TYPE.length) {
        formik.setFieldValue("paymentTypes", []);
        return [];
      }
      formik.setFieldValue("paymentTypes", [1, 2, 3, 4, 5]);
      return [1, 2, 3, 4, 5];
    } else {
      formik.setFieldValue("paymentTypes", value);
      return value;
    }
  };

  const handleClothingTypeChange = (value) => {
    setClothingType(value);
    formik.setFieldValue("clothingType", value);
    formik.setFieldValue("size", null);
    updateSizeOptions(value);
  };

  const updateSizeOptions = (type) => {
    switch (type) {
      case "shoes":
        setSizeOptions([
          "5",
          "5.5",
          "6",
          "6.5",
          "7",
          "7.5",
          "8",
          "8.5",
          "9",
          "9.5",
          "10",
          "10.5",
          "11",
          "11.5",
          "12",
          "12.5",
          "13",
          "13.5",
          "14",
        ]);
        break;
      default:
        setSizeOptions(["XXS", "XS", "S", "M", "L", "XL", "XXL"]);
    }
  };
  
  const getCategoryInfo = () => {
    return categoryInfo[formik.values.category] || categoryInfo['default'];
  };

  const { label, width, enableSerialNumber } = getCategoryInfo();

  const categoricalProperties = () => {
    switch (formik.values.category) {
      case "Art":
        return (
          <div className="flex justify-between mt-4 ">
            <Form.Item label="Artist" name="artist" className="w-72">
              <Input
                label="artist"
                placeholder="Enter Artist"
                name="artist"
                value={formik.values.artist}
                onChange={formik.handleChange}
              />
              {formik.touched.artist && formik.errors.artist && (
                <span className="text-error text-xs">
                  {formik.errors.artist}
                </span>
              )}
            </Form.Item>
          </div>
        );
      case "Carbon":
        return (
          <div className="flex justify-between mt-4 ">
            {/* <Form.Item
              label="Project Type"
              name="projectType"
              className="w-72"
            >
              <Input
                label="projectType"
                placeholder="Enter Project Type"
                name="projectType"
                value={formik.values.projectType}
                onChange={formik.handleChange}
              />
              {formik.touched.projectType &&
                formik.errors.projectType && (
                  <span className="text-error text-xs">
                    {formik.errors.projectType}
                  </span>
                )}
            </Form.Item> */}
            <Form.Item label="Units" name="units" className="w-72">
              <Input
                label="units"
                placeholder="Enter Units"
                name="units"
                value={formik.values.units}
                onChange={formik.handleChange}
              />
              {formik.touched.units && formik.errors.units && (
                <span className="text-error text-xs">
                  {formik.errors.units}
                </span>
              )}
            </Form.Item>
          </div>
        );
      case "Clothing":
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <Form.Item label="Type" name="clothingType">
              <Select
                id="clothingType"
                label="clothingType"
                name="clothingType"
                value={formik.values.clothingType}
                placeholder="Select Type of Clothing"
                onChange={handleClothingTypeChange}
              >
                <Option value="shirt">Shirt</Option>
                <Option value="jacket">Jacket</Option>
                <Option value="pants">Pants</Option>
                <Option value="shoes">Shoes</Option>
                <Option value="accessories">Accessories</Option>
              </Select>
              {formik.touched.clothingType && formik.errors.clothingType && (
                <span className="text-error text-xs">
                  {formik.errors.clothingType}
                </span>
              )}
            </Form.Item>
            <Form.Item label="Brand" name="brand">
              <Input
                id="brand"
                name="brand"
                placeholder="Enter Brand"
                value={formik.values.brand}
                onChange={formik.handleChange}
              />
              {formik.touched.brand && formik.errors.brand && (
                <span className="text-error text-xs">
                  {formik.errors.brand}
                </span>
              )}
            </Form.Item>
            <Form.Item label="Size" name="size">
              <Select
                id="size"
                label="size"
                name="size"
                placeholder="Select Size"
                value={formik.values.size}
                onChange={(value) => formik.setFieldValue("size", value)}
                disabled={!clothingType}
              >
                {sizeOptions.map((size, index) => (
                  <Option key={index} value={size}>
                    {size}
                  </Option>
                ))}
              </Select>
              {formik.touched.size && formik.errors.size && (
                <span className="text-error text-xs">{formik.errors.size}</span>
              )}
            </Form.Item>
            <Form.Item label="Condition" name="condition">
              <Select
                id="condition"
                name="condition"
                value={formik.values.condition}
                placeholder="Select Condition"
                onChange={(value) => formik.setFieldValue("condition", value)}
                onBlur={formik.handleBlur}
              >
                <Option value="new">New</Option>
                <Option value="conditional">Conditional</Option>
                <Option value="used">Used</Option>
              </Select>
              {formik.touched.condition && formik.errors.condition && (
                <span className="text-error text-xs">
                  {formik.errors.condition}
                </span>
              )}
            </Form.Item>
            <Form.Item label="SKU" name="skuNumber">
              <Input
                id="skuNumber"
                name="skuNumber"
                value={formik.values.skuNumber}
                placeholder="Enter SKU Number"
                onChange={formik.handleChange}
              />
              {formik.touched.skuNumber && formik.errors.skuNumber && (
                <span className="text-error text-xs">
                  {formik.errors.skuNumber}
                </span>
              )}
            </Form.Item>
            <Form.Item label="Units" name="units">
              <Input
                id="units"
                name="units"
                value={formik.values.units}
                placeholder="Enter Units"
                onChange={formik.handleChange}
              />
              {formik.touched.units && formik.errors.units && (
                <span className="text-error text-xs">
                  {formik.errors.units}
                </span>
              )}
            </Form.Item>
          </div>
        );
      case "Collectibles":
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <Form.Item label="Condition" name="condition">
              <Select
                id="condition"
                name="condition"
                value={formik.values.condition}
                placeholder="Select Condition"
                onChange={(value) => formik.setFieldValue("condition", value)}
                onBlur={formik.handleBlur}
              >
                <Option value="new">New</Option>
                <Option value="conditional">Conditional</Option>
                <Option value="used">Used</Option>
              </Select>
              {formik.touched.condition && formik.errors.condition && (
                <span className="text-error text-xs">
                  {formik.errors.condition}
                </span>
              )}
            </Form.Item>
            <Form.Item label="Units" name="units">
              <Input
                id="units"
                name="units"
                value={formik.values.units}
                placeholder="Enter Units"
                onChange={formik.handleChange}
              />
              {formik.touched.units && formik.errors.units && (
                <span className="text-error text-xs">
                  {formik.errors.units}
                </span>
              )}
            </Form.Item>
          </div>
        );
      case "Metals":
        return (
          <div className="flex justify-between mt-4 ">
            <Form.Item label="Source" name="source" className="w-72">
              <Input
                label="source"
                placeholder="Enter Material Source"
                name="source"
                value={formik.values.source}
                onChange={formik.handleChange}
              />
              {formik.touched.source && formik.errors.source && (
                <span className="text-error text-xs">
                  {formik.errors.source}
                </span>
              )}
            </Form.Item>
          </div>
        );
      case 'Membership':
        return (
          <div className="flex justify-between mt-4 ">
            <Form.Item
              label="Expiration (in months)"
              name="expirationPeriodInMonths"
              className="w-72"
            >
              <Input
                label="expirationPeriodInMonths"
                placeholder="Enter Expiration (in months)"
                name="expirationPeriodInMonths"
                value={formik.values.expirationPeriodInMonths}
                onChange={formik.handleChange}
              />
              {formik.touched.expirationPeriodInMonths &&
                formik.errors.expirationPeriodInMonths && (
                  <span className="text-error text-xs">
                    {formik.errors.expirationPeriodInMonths}
                  </span>
                )}
            </Form.Item>
            <Form.Item
              label="Units"
              name="units"
              className="w-72"
            >
              <Input
                label="units"
                placeholder="Enter Units"
                name="units"
                value={formik.values.units}
                onChange={formik.handleChange}
              />
              {formik.touched.units &&
                formik.errors.units && (
                  <span className="text-error text-xs">
                    {formik.errors.units}
                  </span>
                )}
            </Form.Item>
          </div>)
      case 'Clothing':
        return (<div className="flex justify-between mt-4 ">
            <Form.Item
              label="Brand"
              name="brand"
              className="w-72"
            >
              <Input
                label="brand"
                placeholder="Enter Clothing Brand"
                name="brand"
                value={formik.values.brand}
                onChange={formik.handleChange}
              />
              {formik.touched.brand &&
                formik.errors.brand && (
                  <span className="text-error text-xs">
                    {formik.errors.brand}
                  </span>
                )}
            </Form.Item>
          </div>)
      case 'Metals':
        return (<div className="flex flex-wrap gap-4 mt-4">
            <Form.Item
              label="Source"
              name="source"
              className="mr-8 w-72"
            >
              <Input
                label="source"
                placeholder="Enter Material Source"
                name="source"
                value={formik.values.source}
                onChange={formik.handleChange}
              />
              {formik.touched.source &&
                formik.errors.source && (
                  <span className="text-error text-xs">
                    {formik.errors.source}
                  </span>
                )}
            </Form.Item>
            <Form.Item
              label="Purity"
              name="purity"
              className="w-72"
            >
              <Input
                label="purity"
                placeholder="Enter Purity"
                name="purity"
                value={formik.values.purity}
                onChange={formik.handleChange}
              />
              {formik.touched.purity &&
                formik.errors.purity && (
                  <span className="text-error text-xs">
                    {formik.errors.purity}
                  </span>
                )}
            </Form.Item>
            <div className="flex justify-between mt-4">
            <Form.Item
                label="Unit of Measurement "
                name="unitOfMeasurement "
                className="w-30 mr-14"
              >
                <Select
                  id="unitOfMeasurement"
                  placeholder="Select Unit of Measurement "
                  allowClear
                  className="w-35"
                  name="unitOfMeasurement.name"
                  value={formik.values.unitOfMeasurement.name}
                  onChange={(value) => {
                    let selectedUOM = unitOfMeasures.find(u => u.value === value);
                    formik.setFieldValue("unitOfMeasurement.name", selectedUOM.name);
                    formik.setFieldValue("unitOfMeasurement.value", value);
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
              label="Least Sellable Unit(s)"
              name="leastSellableUnits"
              className="w-30 mr-14"
            >
              <Input
                label="leastSellableUnits"
                placeholder="Enter Least Sellable Units"
                name="leastSellableUnits"
                value={formik.values.leastSellableUnits}
                onChange={formik.handleChange}
              />
              {formik.touched.leastSellableUnits &&
                formik.errors.leastSellableUnits && (
                  <span className="text-error text-xs">
                    {formik.errors.leastSellableUnits}
                  </span>
                )}
            </Form.Item>
            <Form.Item
              label="Quantity"
              name="units"
              className="w-30"
            >
              <Input
                label="units"
                placeholder="Enter Quantity"
                name="units"
                value={formik.values.units}
                onChange={formik.handleChange}
              />
              {formik.touched.units &&
                formik.errors.units && (
                  <span className="text-error text-xs">
                    {formik.errors.units}
                  </span>
                )}
            </Form.Item>
            </div>
            </div>)
      default:
        break;
    }
  };

  const disabled = isCreateInventorySubmitting || isUploadImageSubmitting;

  return (
    <>
      {contextHolder}
      <Modal
        open={open}
        centered
        onCancel={handleCancel}
        width={673}
        footer={[
          <div className="flex justify-center">
            <Button
              className="w-40"
              key="submit"
              type="primary"
              onClick={formik.handleSubmit}
              disabled={disabled}
            >
              {disabled ? <Spin /> : "Create Item"}
            </Button>
          </div>,
        ]}
      >
        <h1 className="text-center font-semibold text-lg text-primaryB">
          Add Item
        </h1>
        <hr className="text-secondryD mt-3" />
          <Form
            layout="vertical"
            className="mt-5"
            onSubmit={formik.handleSubmit}
          >
            <div className="w-full mb-3">
              <div className="flex justify-between mt-4 ">
                <Form.Item label="Name" name="name" className="w-72">
                  <Input
                    label="name"
                    placeholder="Enter Name"
                    name="name"
                    disabled={false}
                    value={formik.values.name}
                    onChange={formik.handleChange}
                  />
                  {formik.touched.name && formik.errors.name && (
                    <span className="text-error text-xs">
                      {formik.errors.name}
                    </span>
                  )}
                </Form.Item>
                <Form.Item label="Category" name="category" className="w-72">
                  <Select
                    id="category"
                    placeholder="Select Category"
                    allowClear
                    name="category"
                    value={formik.values.category}
                    onChange={(value) => {
                      formik.setFieldValue("category", value);
                    }}
                  >
                    {CATEGORIES.map((e, index) => (
                      <Option value={e} key={index}>
                        {e}
                      </Option>
                    ))}
                  </Select>
                  {getIn(formik.touched, "category") &&
                    getIn(formik.errors, "category") && (
                      <span className="text-error text-xs">
                        {getIn(formik.errors, "category")}
                      </span>
                    )}
                </Form.Item>
              </div>
              {categoricalProperties()}
              <div className="flex justify-between mt-4 ">
                <Form.Item label="Payment Types" name="paymentTypes" className={width} getValueFromEvent={handleSelectAll}>
                  <Select
                    id="paymentTypes"
                    mode="multiple"
                    tagRender={tagRender}
                    placeholder="Select Payment Types"
                    allowClear
                    name="paymentTypes"
                    maxTagCount="responsive"
                    value={formik.values.paymentTypes}
                    onChange={handleSelectAll}
                    showSearch={false}
                  >
                    {PAYMENT_TYPE.map((e, index) => (
                      <Option value={e.value} key={index}>
                        {e.name}
                      </Option>
                    ))}
                  </Select>
                  {getIn(formik.touched, "paymentTypes") &&
                    getIn(formik.errors, "paymentTypes") && (
                      <span className="text-error text-xs">
                        {getIn(formik.errors, "paymentTypes")}
                      </span>
                    )}
                </Form.Item>
                <Form.Item
                  label={label}
                  name="price"
                  className="w-72"
                >
                  <InputNumber
                    label="price"
                    placeholder="Enter Price"
                    name="price"
                    addonAfter="$"
                    min={0}
                    value={formik.values.price}
                    onChange={(value) => formik.setFieldValue("price", value)}
                  />
                  {formik.touched.price &&
                    formik.errors.price && (
                      <span className="text-error text-xs">
                        {formik.errors.price}
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

            <div className="mt-4 flex justify-between">
              <Form.Item label="Upload Images" name="images">
                <div className="h-48 p-4 border-secondryD border rounded flex flex-col justify-around">
                  {selectedImage ? (
                    <div className="h-20">
                      <img
                        alt="Item"
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
                      setSelectedImage(
                        URL.createObjectURL(e.file.originFileObj)
                      );
                      formik.setFieldValue("images", e.file.originFileObj);
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
                  {formik.touched.images && formik.errors.images && (
                    <span className="text-error text-xs">
                      {formik.errors.images}
                    </span>
                  )}
                </Form.Item>
                <div className="flex flex-col">
                  <Form.Item
                    label="Serial Number"
                    name="serialNumber"
                    className="w-72"
                  >
                    <Input
                      label="serialNumber"
                      placeholder="Enter Serial Number"
                      name="serialNumber"
                      value={enableSerialNumber ? formik.values.serialNumber : ""}
                      onChange={(e) => {
                        // Allow changes only if enableSerialNumber is true
                        if (enableSerialNumber) {
                          formik.handleChange(e);
                        }
                      }}
                      disabled={!enableSerialNumber}
                    />
                    {formik.touched.serialNumber &&
                      formik.errors.serialNumber && (
                        <span className="text-error text-xs">
                          {formik.errors.serialNumber}
                        </span>
                      )}
                  </Form.Item>
                </div>
              </div>
            </div>
          </Form>
      </Modal>
      {uploadErr && openToast("bottom")}
    </>
  );
};

export default CreateInventoryModal;