import React, { useState } from "react";
import { useFormik, getIn } from "formik";
import {
  Form,
  Modal,
  Input,
  Select,
  Tag,
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
import TextArea from "antd/es/input/TextArea";
import getSchema from "./InventorySchema";
import { usePapaParse } from "react-papaparse";
import TagManager from "react-gtm-module";
import { CATEGORIES, PAYMENT_TYPE, unitOfMeasures } from "../../helpers/constants";

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
  const [selectedImages, setSelectedImages] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState(null);
  const [clothingType, setClothingType] = useState(null);
  const [sizeOptions, setSizeOptions] = useState([]);

  const initialValues = {
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
    quantity: 1,
    expirationPeriodInMonths: 1,
    clothingType: null,
    images: null,
    files: null,
    category: "Art",
    subCategory: null,
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

  const beforeImageUpload = (file) => {
    const isJpgOrPng = file.type === "image/jpeg" || file.type === "image/png";
    if (!isJpgOrPng) {
      setUploadErr("Image must be of jpeg or png format");
      return Upload.LIST_IGNORE;
    }
    const isLt1M = file.size / 1024 / 1024 < 1;
    if (!isLt1M) {
      setUploadErr("Cannot upload an image of size more than 1mb");
      return Upload.LIST_IGNORE;
    }
    const isNameLengthValid = file.name.length <= 100;
    if (!isNameLengthValid) {
      setUploadErr("File name must be less than 100 characters");
      return Upload.LIST_IGNORE;
    }
    setUploadErr("");
    return false
  };

  const handleImageChange = (info) => {
    setSelectedImages(info.fileList);
  };

  const beforeFileUpload = (file) => {
    const isPdf = file.type === "application/pdf";
    if (!isPdf) {
      setUploadErr("File must be PDF format");
      return Upload.LIST_IGNORE;
    }
    const isLt1M = file.size / 1024 / 1024 < 1;
    if (!isLt1M) {
      setUploadErr("Cannot upload a PDF of size more than 1mb");
      return Upload.LIST_IGNORE;
    }
    const isNameLengthValid = file.name.length <= 100;
    if (!isNameLengthValid) {
      setUploadErr("File name must be less than 100 characters");
      return Upload.LIST_IGNORE;
    }
    setUploadErr("");
    return false;
  };

  const handleFileChange = (info) => {
    setSelectedFiles(info.fileList);
  };
  

  const handleCreateFormSubmit = async (values) => {
    let imageKeys = []
    if (values.images && values.images.length > 0) {
      for (const img of values.images) {
        const formData = new FormData();
        formData.append(img.name, img);
        const imageData = await actions.uploadImage(dispatch, formData);
        // Sometimes the image fits the criteria and the upload fails. 
        // These should be checked before submitting the form
        if (imageData) imageKeys.push(imageData);
      }
    }

    let fileKeys = []
    if (values.files && values.files.length > 0) {
      for (const file of values.files) {
        const formData = new FormData();
        formData.append(file.name, file);
        const fileData = await actions.uploadImage(dispatch, formData);
        if (fileData) fileKeys.push(fileData);
      }
    }

    const body = {
      itemArgs: {
        name: values.name,
        description: values.description,
        images: imageKeys || [],
        files: fileKeys || [],
      },
    };

    const finalBody = (body) => {
      switch (values.subCategory) {
        case "Art":
          return (body = {
            itemArgs: {
              ...body.itemArgs,
              artist: values.artist,
            },
          });
        case "CarbonOffset":
          const { serialNumber, ...restArgs } = body.itemArgs;
          return (body = {
            itemArgs: {
              ...restArgs,
              quantity: values.quantity,
            }
          });
        case 'Clothing':
          return (body = {
            itemArgs: {
              ...body.itemArgs,
              clothingType: values.clothingType,
              skuNumber: values.skuNumber,
              size: values.size,
              condition: values.condition,
              brand: values.brand,
              quantity: values.quantity,
            },
          });
        case "Collectibles":
          return (body = {
            itemArgs: {
              ...body.itemArgs,
              condition: values.condition,
              quantity: values.quantity,
            },
          });
        case "Metals":
          const selectedUOM = unitOfMeasures.find(u => u.value === values.unitOfMeasurement.value);

          return (body = {
            itemArgs: {
              ...body.itemArgs,
              quantity: values.quantity,
              unitOfMeasurement: selectedUOM.value,
              leastSellableUnits: values.leastSellableUnits,
              source: values.source,
              purity: values.purity
            }
          });
        case 'Membership':
          return (body = {
            itemArgs: {
              ...body.itemArgs,
              quantity: values.quantity,
              expirationPeriodInMonths: values.expirationPeriodInMonths
            }
          });
        case 'CarbonDAO':
          return (body = {
            itemArgs: {
              ...body.itemArgs,
              quantity: values.quantity
            }
          });
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
      values.subCategory
    );

    if (isDone) {
      if (page === 1)
        await actions.fetchInventory(dispatch, 10, 0, debouncedSearchTerm, undefined);
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

  const categoricalProperties = () => {
    switch (formik.values.subCategory) {
      case "Art":
        return (
          <div className="flex justify-between mt-4 ">
            <Form.Item label="Artist" className="w-full md:w-72">
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
      case "CarbonOffset":
        return (
          <div className="flex justify-between mt-4 ">
            <Form.Item
              label="Quantity"
              className="w-full md:w-72"
            >
              <Input
                label="quantity"
                placeholder="Enter Quantity"
                name="quantity"
                value={formik.values.quantity}
                onChange={formik.handleChange}
              />
              {formik.touched.quantity &&
                formik.errors.quantity && (
                  <span className="text-error text-xs">
                    {formik.errors.quantity}
                  </span>
                )}
            </Form.Item>
          </div>
        );
      case "Clothing":
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <Form.Item label="Type">
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
            <Form.Item label="Brand">
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
            <Form.Item label="Size">
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
            <Form.Item label="Condition">
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
            <Form.Item label="SKU">
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
            <Form.Item label="Quantity">
              <Input
                id="quantity"
                name="quantity"
                value={formik.values.quantity}
                placeholder="Enter Quantity"
                onChange={formik.handleChange}
              />
              {formik.touched.quantity && formik.errors.quantity && (
                <span className="text-error text-xs">
                  {formik.errors.quantity}
                </span>
              )}
            </Form.Item>
          </div>
        );
      case "Collectibles":
        return (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <Form.Item label="Condition">
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
            <Form.Item label="Quantity">
              <Input
                id="quantity"
                name="quantity"
                value={formik.values.quantity}
                placeholder="Enter Quantity"
                onChange={formik.handleChange}
              />
              {formik.touched.quantity && formik.errors.quantity && (
                <span className="text-error text-xs">
                  {formik.errors.quantity}
                </span>
              )}
            </Form.Item>
          </div>
        );
      case "Metals":
        return (<div className="flex flex-wrap gap-4 mt-4">
          <Form.Item
            label="Source"
            className=" w-full md:w-72"
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
            className="w-full md:w-72"
          >
            <Input
              label="purity"
              placeholder="Enter Purity (Ex: 999/1000)"
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
          <div className="flex justify-between gap-4 flex-wrap md:flex-nowrap mt-4">
            <Form.Item
              label="Unit of Measurement "
              className="w-full md:w-[200px] "
            >
              <Select
                id="unitOfMeasurement"
                placeholder="Select Unit of Measurement "
                allowClear
                className="w-full "
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
              className=" w-full sm:w-[200px] md:w-30"
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
            <Form.Item label="Quantity" className="w-full sm:w-[200px] md:w-30">
              <Input
                id="quantity"
                name="quantity"
                value={formik.values.quantity}
                placeholder="Enter Quantity"
                onChange={formik.handleChange}
              />
              {formik.touched.quantity && formik.errors.quantity && (
                <span className="text-error text-xs">
                  {formik.errors.quantity}
                </span>
              )}
            </Form.Item>
          </div>
        </div>);
      case 'Membership':
        return (
          <div className="flex flex-wrap sm:flex-nowrap justify-between gap-4 mt-4 ">
            <Form.Item
              label="Expiration (in months)"
              className="w-full sm:w-72"
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
              label="Quantity"
              className="w-full sm:w-72"
            >
              <Input
                label="quantity"
                placeholder="Enter Quantity"
                name="quantity"
                value={formik.values.quantity}
                onChange={formik.handleChange}
              />
              {formik.touched.quantity &&
                formik.errors.quantity && (
                  <span className="text-error text-xs">
                    {formik.errors.quantity}
                  </span>
                )}
            </Form.Item>
          </div>);
      case 'CarbonDAO':
        return (
          <div className="flex justify-between mt-4 ">
            <Form.Item
              label="Quantity"
              className="w-72"
            >
              <Input
                label="quantity"
                placeholder="Enter Quantity"
                name="quantity"
                value={formik.values.quantity}
                onChange={formik.handleChange}
              />
              {formik.touched.quantity &&
                formik.errors.quantity && (
                  <span className="text-error text-xs">
                    {formik.errors.quantity}
                  </span>
                )}
            </Form.Item>
          </div>)
      default:
        break;
    }
  };
  const disabled = isCreateInventorySubmitting || isUploadImageSubmitting

  /*
              <div className="flex justify-between mt-4 ">
                <Form.Item label="Payment Types" name="paymentTypes" className="w-72" getValueFromEvent={handleSelectAll}>
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
                  label={formik.values.category === 'Carbon' ? 'Price per unit' : 'Price'}
                  name="price"
                  className="w-72"
                >
                  <Input
                    label="price"
                    placeholder="Enter Price"
                    name="price"
                    value={formik.values.price}
                    onChange={formik.handleChange}
                  />
                  {formik.touched.price &&
                    formik.errors.price && (
                      <span className="text-error text-xs">
                        {formik.errors.price}
                      </span>
                    )}
                </Form.Item>
              </div>
  */
  return (
    <>
      {contextHolder}
      <Modal
        open={open}
        centered
        onCancel={handleCancel}
        width={673}
        footer={[
          <div className="flex justify-center mb-5 pt-4">
            <Button
              className="w-40"
              key="submit"
              type="primary"
              onClick={formik.handleSubmit}
              disabled={disabled}
            >
            {disabled ? <Spin /> : "Create Inventory"}
            </Button>
          </div>,
        ]}
      >
        <h1 className=" font-semibold text-lg text-[#202020]">
          Create Inventory
        </h1>
        <hr className="text-secondryD mt-3" />
        <Form layout="vertical" className="mt-5 inventory_modal" onSubmit={formik.handleSubmit}>
          <div className="w-full mb-3">
            <div className="flex flex-wrap sm:flex-nowrap justify-between gap-4 mt-4 ">
              <Form.Item label="Name" className="w-full sm:w-[200px] md:w-72 ">
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

              <Form.Item label="Category" className=" w-full sm:w-[200px] md:w-72 ">
                <Select
                  id="category"
                  placeholder="Select Category"
                  allowClear
                  name="category"
                  value={formik.values.category}
                  onChange={(value) => {
                    formik.setFieldValue("category", value);
                    formik.setFieldValue("subCategory", null);
                  }}
                >
                  {categorys.map((e, index) => (
                    <Option value={e.name} key={index}>
                      {e.name}
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



              <Form.Item label="Sub Category" className="w-full sm:w-[200px] md:w-72">
                <Select
                  id="subCategory"
                  placeholder="Select Sub Category"
                  allowClear
                  name="subCategory"
                  value={formik.values.subCategory}
                  onChange={(value) => {
                    formik.setFieldValue("subCategory", value);
                  }}
                >
                  {categorys.map((category) =>
                    category.name === formik.values.category ? category.subCategories.map((e, index) => (
                      <Option value={e.contract} key={index}>
                        {e.name}
                      </Option>
                    )) : null
                  )}

                  {/* {CATEGORIES.map((e, index) => (
                      <Option value={e} key={index}>
                        {e}
                      </Option>
                    ))} */}
                </Select>
                {getIn(formik.touched, "subCategory") &&
                  getIn(formik.errors, "subCategory") && (
                    <span className="text-error text-xs">
                      {getIn(formik.errors, "subCategory")}
                    </span>
                  )}
              </Form.Item>
            </div>
            {categoricalProperties()}
            <div className="flex justify-between mt-4 ">
              <Form.Item label="Description" className="w-full">
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
            </div>
            <div className="mt-4 flex-wrap gap-5 sm:flex-nowrap flex justify-between">
              <Form.Item label="Upload Images" className="w-full sm:w-[200px] md:w-72">
                <div className="p-4 border-secondryD border rounded flex flex-col justify-around">
                  <Upload
                    onChange={handleImageChange}
                    fileList={selectedImages}
                    accept="image/png, image/jpeg"
                    multiple={true}
                    maxCount={10}
                    beforeUpload={beforeImageUpload}
                    listType="picture"
                  >
                    <div className="text-primary border border-primary rounded px-4 py-2 text-center hover:text-white hover:bg-primary cursor-pointer">
                      Browse Images
                    </div>
                  </Upload>
                </div>

                <div className="flex items-start">
                  <p className="mt-1 text-xs italic font-medium ">Note:</p>
                  <p className="mt-1 text-xs italic ml-1 mr-4">
                    use jpg, png format of size less than 1mb. Limit of 10.
                  </p>
                </div>
                {formik.touched.images && formik.errors.images && (
                  <span className="text-error text-xs">
                    {formik.errors.images}
                  </span>
                )}
              </Form.Item>
              <Form.Item label="Upload Files" className="w-full sm:w-[200px] md:w-72">
                <div className="p-4 border-secondryD border rounded flex flex-col justify-around">
                  <Upload
                    onChange={handleFileChange}
                    fileList={selectedFiles}
                    accept="application/pdf"
                    multiple={true}
                    maxCount={10}
                    beforeUpload={beforeFileUpload}
                  >
                    <div className="text-primary border border-primary rounded px-4 py-2 text-center hover:text-white hover:bg-primary cursor-pointer">
                      Browse Files
                    </div>
                  </Upload>
                </div>

                <div className="flex items-start">
                  <p className="mt-1 text-xs italic font-medium ">Note:</p>
                  <p className="mt-1 text-xs italic ml-1 mr-4">
                    use pdf format of size less than 1mb. Limit of 10.
                  </p>
                </div>
                {formik.touched.files && formik.errors.files && (
                  <span className="text-error text-xs">
                    {formik.errors.files}
                  </span>
                )}
              </Form.Item>
            </div>
          </div>
        </Form>
      </Modal>
      {uploadErr && openToast("bottom")}
    </>
  );
};

export default CreateInventoryModal;