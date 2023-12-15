import React, { useState } from "react";
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
import { actions } from "../../contexts/inventory/actions";
import TextArea from "antd/es/input/TextArea";
import TagManager from "react-gtm-module";
import { CATEGORIES, unitOfMeasures } from "../../helpers/constants";
import CategoryFields from "./CategoryFields";

const { Option } = Select;

const CreateInventoryModal = ({
  open,
  handleCancel,
  debouncedSearchTerm,
  resetPage,
  page,
}) => {
  const [form] = Form.useForm();
  const [category, setCategory] = useState("Art");
  const dispatch = useInventoryDispatch();
  const [api, contextHolder] = notification.useNotification();
  const [uploadErr, setUploadErr] = useState("");
  const { isCreateInventorySubmitting, isUploadImageSubmitting } = useInventoryState();
  const [selectedImages, setSelectedImages] = useState(null);
  const [selectedFiles, setSelectedFiles] = useState(null);
  const [clothingType, setClothingType] = useState(null);
  const [sizeOptions, setSizeOptions] = useState([]);

  function beforeImageUpload(file) {
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

  function beforeFileUpload(file) {
    const isPdf = file.type === "application/pdf";
    if (!isPdf) {
      setUploadErr("File must be PDF format");
    }
    const isLt1M = file.size / 1024 / 1024 < 1;
    if (!isLt1M) {
      setUploadErr("Cannot upload a PDF of size more than 1mb");
    }
    return isPdf && isLt1M;
  }

  const handleCreateFormSubmit = async (values) => {
    let imageKeys = []
    if (values.images && values.images.length > 0) {
      for (const img of values.images) {
        const formData = new FormData();
        formData.append(img.name, img);
        const imageData = await actions.uploadImage(dispatch, formData);
        imageKeys.push(imageData);
      }
    }

    let fileKeys = []
    if (values.files && values.files.length > 0) {
      for (const file of values.files) {
        const formData = new FormData();
        formData.append(file.name, file);
        const fileData = await actions.uploadImage(dispatch, formData);
        fileKeys.push(fileData);
      }
    }

    const { category, ...restOfValues } = values;
    const body = {
      itemArgs: {
        ...restOfValues,
        images: imageKeys,
        files: fileKeys,
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
      body,
      values.category
    );

    if (isDone) {
      if (page === 1)
        actions.fetchInventory(dispatch, 10, 0, debouncedSearchTerm);
      form.resetFields();
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
    if (type === "shoes") {
      setSizeOptions(["5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "12.5", "13", "13.5", "14",]);
    } else {
      setSizeOptions(["XXS", "XS", "S", "M", "L", "XL", "XXL"]);
    }
  };

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
              type="primary"
              onClick={() => {
                form.validateFields().then((values) => {
                  handleCreateFormSubmit(values);
                })
              }}
              loading={isCreateInventorySubmitting || isUploadImageSubmitting}
            >
              Create Inventory
            </Button>
          </div>,
        ]}
      >
        <h1 className="text-center font-semibold text-lg text-primaryB">
          Add Item
        </h1>
        <hr className="text-secondryD mt-3" />
        <Form layout="vertical"
          form={form}
          className="mt-5"
          initialValues={{
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
            brand: "",
            clothingType: null,
            images: null,
            files: null,
            category: "Art",
            size: null,
            skuNumber: null,
            condition: null,
            brand: null,
          }}
        >
          <div className="w-full mb-3">
            <div className="flex justify-between mt-4 ">
              <Form.Item
                label="Name"
                name="name"
                className="w-72"
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
                className="w-72"
                rules={[
                  {
                    required: true,
                    message: 'Please select a category',
                  },
                ]}
              >
                <Select
                  placeholder="Select Category"
                  allowClear
                  onChange={(value) => setCategory(value)}
                >
                  {CATEGORIES.map((e, index) => (
                    <Option value={e} key={index}>
                      {e}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </div>
            <CategoryFields
              category={category}
              handleClothingTypeChange={handleClothingTypeChange}
              clothingType={clothingType}
              sizeOptions={sizeOptions}
              unitOfMeasures={unitOfMeasures}
            />
            <div className="flex justify-between mt-4 ">
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
                <TextArea
                  placeholder="Enter Description"
                />
              </Form.Item>
            </div>
            <div className="mt-4 flex justify-between">
              <Form.Item label="Upload Images" name="images" className="w-72">
                <div className="p-4 border-secondryD border rounded flex flex-col justify-around">
                  <Upload
                    onChange={(es) => {
                      if (es && es.fileList && es.fileList.length > 0) {
                        setSelectedImages(es.fileList);
                        form.setFieldValue("images", es.fileList.map((e) => e.originFileObj))
                      }
                    }}
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
                    use jpg, png format of size less than 1mb
                  </p>
                </div>
              </Form.Item>
              <Form.Item label="Upload Files" name="files" className="w-72">
                <div className="p-4 border-secondryD border rounded flex flex-col justify-around">
                  <Upload
                    onChange={(es) => {
                      if (es && es.fileList && es.fileList.length > 0) {
                        setSelectedFiles(es.fileList);
                        form.setFieldValue("files", es.fileList.map((e) => e.originFileObj))
                      }
                    }}
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
                    use pdf format of size less than 1mb
                  </p>
                </div>
              </Form.Item>
            </div>
          </div>
        </Form>
      </Modal >
      {uploadErr && openToast("bottom")
      }
    </>
  );
};

export default CreateInventoryModal;