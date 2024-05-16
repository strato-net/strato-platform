import React, { useEffect, useState } from "react";
import {
  Form,
  Modal,
  Input,
  Select,
  Button,
  Upload,
  notification,
} from "antd";
import {
  useInventoryDispatch,
  useInventoryState,
} from "../../contexts/inventory";
import { useRedemptionDispatch, useRedemptionState } from "../../contexts/redemption";
import { actions as redemptionActions } from "../../contexts/redemption/actions";
import { actions } from "../../contexts/inventory/actions";
import TextArea from "antd/es/input/TextArea";
import TagManager from "react-gtm-module";
import { unitOfMeasures, unitOfSpiritMeasures } from "../../helpers/constants";
import { categoricalProperties } from "./CategoryFields";
import RichEditor from "../RichEditor";

const { Option } = Select;

const CreateInventoryModal = ({
  open,
  handleCancel,
  categorys,
  debouncedSearchTerm,
  resetPage,
  page,
  categoryName,
}) => {
  const [form] = Form.useForm();
  const dispatch = useInventoryDispatch();
  const [api, contextHolder] = notification.useNotification();
  const [uploadErr, setUploadErr] = useState("");
  const { isCreateInventorySubmitting, isUploadImageSubmitting } =
    useInventoryState();
  const { redemptionServices, isFetchingRedemptionServices } = useRedemptionState();
  const redemptionDispatch = useRedemptionDispatch();
  const [selectedImages, setSelectedImages] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState(null);
  const [clothingType, setClothingType] = useState(null);
  const [sizeOptions, setSizeOptions] = useState([]);
  const [categoryValue, setCategoryValue] = useState("Art");
  const [subCategoryValue, setSubCategoryValue] = useState(form.getFieldValue("subCategory"));
  const [measureUnit, setMeasureUnit] = useState(unitOfMeasures);

  useEffect(() => {
    redemptionActions.fetchRedemptionServices(redemptionDispatch);
  }, [redemptionDispatch]);

  const beforeImageUpload = (file) => {
    const isJpgOrPng = file.type === "image/jpeg" || file.type === "image/png";
    if (!isJpgOrPng) {
      setUploadErr("Image must be of jpeg or png format");
      return Upload.LIST_IGNORE;
    }
    const isLt5M = file.size / 1024 / 1024 < 5;
    if (!isLt5M) {
      setUploadErr("Cannot upload image files of total size more than 5mb");
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
    form.setFieldValue("images", info.fileList.map((e) => e.originFileObj))
  };

  const beforeFileUpload = (file) => {
    const isPdf = file.type === "application/pdf";
    if (!isPdf) {
      setUploadErr("File must be PDF format");
      return Upload.LIST_IGNORE;
    }
    const isLt5M = file.size / 1024 / 1024 < 5; // Check if the file size is less than 6 MB
    if (!isLt5M) {
      setUploadErr("Cannot upload a PDF of size more than 5 MB");
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
    form.setFieldValue("files", info.fileList.map((e) => e.originFileObj))
  };

  const handleCreateFormSubmit = async (values) => {
    let imageKeys = []
    if (values.images && values.images.length > 0) {
      for (const img of values.images) {
        const formData = new FormData();
        formData.append(img.name, img);
        const imageData = await actions.uploadImage(dispatch, formData);
        if (imageData) {
          imageKeys.push(imageData);
        } else {
          throw new Error("Image upload failed");
        }
      }
    }

    let fileKeys = []
    if (values.files && values.files.length > 0) {
      for (const file of values.files) {
        const formData = new FormData();
        formData.append(file.name, file);
        const fileData = await actions.uploadImage(dispatch, formData);
        if (fileData) {
          fileKeys.push(fileData);
        } else {
          throw new Error("File upload failed");
        }
      }
    }

    const { category, subCategory, images, files, ...body } = values;
    const redemptionService = redemptionServices ? (redemptionServices[0] || {}).address : undefined;
    const newBody = {
      itemArgs: {
        images: imageKeys || [],
        files: fileKeys || [],
        redemptionService,
        ...body
      },
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
      newBody,
      subCategory
    );

    if (isDone) {
      if (page === 1)
        await actions.fetchInventory(dispatch, 10, 0, debouncedSearchTerm, categoryName);
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

  const handleClothingTypeChange = (value) => {
    setClothingType(value);
    form.setFieldValue("clothingType", value);
    form.setFieldValue("size", null);
    updateSizeOptions(value);
  };

  const updateSizeOptions = (type) => {
    if (type === "Shoes") {
      setSizeOptions(["3.5", "4", "4.5", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "12.5", "13", "13.5", "14", "14.5", "15", "16", "17", "18"]);
    } else {
      setSizeOptions(["OS (One Size)", "XXS", "XS", "S", "M", "L", "XL", "XXL"]);
    }
  };

  const handleCategory = (value) => {
    form.setFieldValue("category", value);
    setCategoryValue(value);
    if (value === 'Carbon') {
      form.setFieldValue("subCategory", null);
      setSubCategoryValue(null);
    } else {
      if (value === "Metals") {
        setMeasureUnit(unitOfMeasures)
      }
      if (value === "Spirits") {
        setMeasureUnit(unitOfSpiritMeasures)
      }

      const subCat = categorys.find(item => item.name === value).subCategories[0].name
      form.setFieldValue("subCategory", subCat);
      setSubCategoryValue(subCat);
    }
  }

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
              id="createItemSubmit"
              className="w-40"
              type="primary"
              onClick={() => {
                form.validateFields().then((values) => {
                  handleCreateFormSubmit(values);
                })
              }}
              loading={isCreateInventorySubmitting || isUploadImageSubmitting || isFetchingRedemptionServices}
            >
              Create Item
            </Button>
          </div>,
        ]}
      >
        <h1 className=" font-semibold text-lg text-[#202020]">
          Create Item
        </h1>
        <hr className="text-secondryD mt-3" />
        <Form
          form={form}
          layout="vertical"
          className="mt-5 inventory_modal"
          initialValues={{
            name: "",
            description: "",
            artist: "",
            source: "",
            leastSellableUnits: 1,
            unitOfMeasurement: 1,
            purity: "",
            quantity: 1,
            expirationPeriodInMonths: 1,
            clothingType: null,
            images: [],
            files: [],
            category: "Art",
            subCategory: null,
            size: null,
            skuNumber: null,
            condition: null,
            brand: null,
          }}
        >
          <div className="w-full mb-3">
            <div className="flex flex-wrap sm:flex-nowrap justify-between gap-4 mt-4">
              <Form.Item
                label="Name"
                name="name"
                className="w-full sm:w-[200px] md:w-72"
                rules={[
                  {
                    required: true,
                    message: 'Please enter a name',
                  },
                ]}
              >
                <Input placeholder="Enter Name" />
              </Form.Item>

              <Form.Item
                label="Category"
                name="category"
                className="w-full sm:w-[200px] md:w-72"
                rules={[
                  {
                    required: true,
                    message: 'Please select a category',
                  },
                ]}
              >
                <Select
                  id="category"
                  placeholder="Select Category"
                  allowClear
                  value={categoryValue}
                  onChange={(value) => {
                    handleCategory(value)
                  }}
                >
                  {categorys.map((e, index) => (
                    <Option value={e.name} key={index}>
                      {e.name}
                    </Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item
                label="Sub Category"
                name="subCategory"
                className="w-full sm:w-[200px] md:w-72"
                rules={[
                  {
                    required: true,
                    message: 'Please select a subcategory',
                  },
                ]}
              >
                <Select
                  id="subCategory"
                  placeholder="Select Sub Category"
                  allowClear
                  value={subCategoryValue}
                  onChange={(value) => {
                    form.setFieldValue("subCategory", value);
                    setSubCategoryValue(value);
                  }}
                >
                  {categorys.map((category) =>
                    category.name === categoryValue ? category.subCategories.map((e, index) => (
                      <Option id="subCategory-options" value={e.contract} key={index}>
                        {e.name}
                      </Option>
                    )) : null
                  )}
                </Select>
              </Form.Item>
            </div>
            {categoricalProperties(form, handleClothingTypeChange, clothingType, sizeOptions, measureUnit)}
            <div className="flex justify-between mt-4 !list-disc">
              <Form.Item
                label="Description"
                name="description"
                className="w-full"
                rules={[
                  {
                    required: true,
                    message: 'Please enter a description',
                  },
                ]}
              >
                <RichEditor
                  id="description"
                  onChange={(content) => {
                    form.setFieldsValue({ description: content });
                  }}
                  initialValue={form.getFieldValue("description") || ""}
                />
              </Form.Item>
            </div>
            <div className="mt-4 flex-wrap gap-5 sm:flex-nowrap flex justify-between">
              <Form.Item
                label="Upload Images"
                name="images"
                className="w-full sm:w-[200px] md:w-72"
                rules={[
                  {
                    required: true,
                    message: 'Please upload an image',
                  },
                ]}
              >
                <div className="p-4 border-secondryD border rounded flex flex-col justify-around">
                  <Upload
                    id="imageUpload"
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
                    use jpg, png format of size less than 5mb. Limit of 10.
                  </p>
                </div>
              </Form.Item>
              <Form.Item
                label="Upload Files"
                name="files"
                className="w-full sm:w-[200px] md:w-72"
              >
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
                    use pdf files with total size of less than 5mb. Limit of 10 files.
                  </p>
                </div>
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