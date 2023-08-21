import React, { useEffect, useState } from "react";
import { useFormik } from "formik";
import {
  Form,
  Modal,
  Input,
  InputNumber,
  Select,
  Button,
  Radio,
  Upload,
  Spin,
  notification,
  Typography,
} from "antd";
import { PlusOutlined, InboxOutlined, MinusOutlined } from "@ant-design/icons";
// import getSchema from "./ProductSchema";
import useDebounce from "../UseDebounce";
//sub-categories
import { actions } from "../../contexts/membership/actions";
import { actions as prodActions} from "../../contexts/product/actions";
import { useMembershipDispatch, useMembershipState } from "../../contexts/membership";
import { useProductDispatch, useProductState } from "../../contexts/product";
import { actions as serviceActions } from "../../contexts/service/actions";
import { useServiceState, useServiceDispatch } from "../../contexts/service";
import ListNowModal from "./ListNowModal";

const { Dragger } = Upload;

const CreateMembershipModal = ({ open, handleCancel, categorys, user }) => {
  // const schema = getSchema();
  const prodDispatch = useProductDispatch();
  const limit = 10;
  // Can update these values for service search later on
  const [offset, setOffset] = useState(0);
  const dispatch = useMembershipDispatch();
  const [previewImage, setPreviewImage] = useState("");
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [imageList, setImageList] = useState([]);
  const [fileList, setFileList] = useState([]);
  const [memberDiscount, setMemberDiscount] = useState([1]);
  const [visible, setVisible] = useState(false);

  const { isCreateProductSubmitting, isuploadImageSubmitting, isCreateMembershipSubmitting } =
    useMembershipState();

  const { services, isservicesLoading } = useServiceState();
  const serviceDispatch = useServiceDispatch();

  const queryValue = user.user.organization;

  // TODO: We should probably only query services made by the user's organization
  useEffect(() => {
    serviceActions.fetchService(
      serviceDispatch,
      limit,
      offset,
      queryValue,
    );
  }, [serviceDispatch, limit, offset, queryValue]);


  const initialValues = {
    name: "",
    category: "",
    duration: "",
    additionalInformation: "",
    images: [],
    description: "",
    price: "",
    quantity: "",
    services: [
      {
        serviceId: "",
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

  const handlePriceDiscountClick = (index) => {
    const updatedMemberDiscount = [...memberDiscount];
    updatedMemberDiscount[index] = 1;
    setMemberDiscount(updatedMemberDiscount);
  };

  const handlePercentDiscountClick = (index) => {
    const updatedMemberDiscount = [...memberDiscount];
    updatedMemberDiscount[index] = 2;
    setMemberDiscount(updatedMemberDiscount);
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

  // This will check the discount type and null the other value in formik
  // Both member price and discount percent are passed. We will null the one that is not being used.
  const checkDiscountType = (discountArray) => {
    for (let i = 0; i < discountArray.length; i++) {
      // If the discount is a 1 we will null the discount percent value in formik
      if (discountArray[i] === 1) {
        const updatedServices = [...formik.values.services];
        updatedServices[i] = {
          ...updatedServices[i],
          percentDiscount: null,
        };
        formik.values.services = updatedServices;
      } else {
        // If the discount is a 2 we will null the discount price value in formik
        const updatedServices = [...formik.values.services];
        updatedServices[i] = {
          ...updatedServices[i],
          memberPrice: null,
        };
        formik.values.services = updatedServices;
      }
    }
    return formik.values;
  };

  const handleCreateFormSubmit = async (values) => {
    console.log("values", values);
    const updatedValues = checkDiscountType(memberDiscount);
    // console.log("updated Values", updatedValues);
    // console.log("values", values);
    
    // for every image in formki.values.images, upload it to s3 and get the url back
    const arrayOfImageData = [];
    const uploadImagePromises = values.images.map(async (image) => {
      const formData = new FormData();
      formData.append("fileUpload", image.originFileObj);
      return prodActions.uploadImage(prodDispatch, formData);
    });
    
    // for every image in formki.values.documents, upload it to s3 and get the url back
    const arrayOfFiles = [];
    const uploadFilePromises = values.documents.map(async (doc) => {
      const formData = new FormData();
      formData.append("fileUpload", doc.originFileObj);
      return prodActions.uploadImage(prodDispatch, formData);
    });
    
    Promise.all(uploadFilePromises)
      .then(async (results0) => {
        arrayOfFiles.push(...results0);
        Promise.all(uploadImagePromises)
          .then(async (results) => {
            arrayOfImageData.push(...results);
            
            const allFiles = arrayOfFiles.concat(arrayOfImageData);

            // TODO: Add image and file upload to S3
            const body = {
              membershipArgs: {
                name: updatedValues.name,
                description: updatedValues.description,
                manufacturer: user.user.organization,
                unitOfMeasurement: 1,
                // Generate random code for now
                userUniqueMembershipCode: `U-ID-${Math.floor(Math.random() * 1000000)}`,
                // Generate random number for now
                uniqueMembershipCode: Math.floor(Math.random() * 1000000),
                leastSellableUnit: 1,
                // TODO: This might have to be changed into an array. 
                imageKey: `${arrayOfImageData[0].imageKey}`,
                category: updatedValues.category,
                subCategory: updatedValues.category,
                createdDate: new Date().getTime(),
                timePeriodInMonths: updatedValues.duration,
                additionalInfo: updatedValues.additionalInformation,
                // If visible is true the List Now form is open and the membership is active
                isActive: visible ? true : false,
              },
              membershipServiceArgs: updatedValues.services.map((service) => ({
                serviceId: service.serviceId,
                membershipPrice: service.memberPrice ? service.memberPrice : 0,
                discountPrice: service.percentDiscount ? service.percentDiscount : 0,
                maxQuantity: service.numberOfUses,
                createdDate: new Date().getTime(),
                // If visible is true the List Now form is open and the membership is active
                isActive: visible ? true : false,
              })),
              //TODO: where do I put the imageKey from the uploaded File?
              productFileArgs: allFiles.map((file) => ({
                fileLocation: `${file.imageKey}`,
                fileHash: `${file.docHash}`,
                fileName: `${file.originalName}`,
                uploadDate: new Date().getTime(),
                createdDate: new Date().getTime(),
                section: 1,
                type: 2,
              })),
            };

            console.log("body", body);
            const isDone = await actions.createMembership(dispatch, body);
            if (isDone) {
              formik.resetForm();
              handleCancel();
            }
          })
          .catch((error) => {
            console.log("inner promise: ",error.message)
            // Handle errors if any of the promises fail
          });
    })
    .catch((error) => {
      console.log("outer promise: ",error.message)
      // Handle errors if any of the promises fail
    });
  };

  const disabled = isCreateProductSubmitting || isuploadImageSubmitting;

  const closeModal = () => {
    handleCancel();
  };

  function beforeUpload() {
    return false;
  }

  const [api, contextHolder] = notification.useNotification();

  const closeListNowModal = () => {
    setVisible(false);
  };

  const openListNowModal = () => {
    setVisible(true);
  };

  const openToast = (placement, message) => {
    api.error({
      message: message,
      onClose: actions.resetMessage(dispatch),
      placement,
      key: 2,
    });
  };

  return (
    <>
      <Modal
        open={open}
        centered
        onCancel={closeModal}
        width={1000}
        footer={[
          <div className="flex justify-end mr-10">
            <Button
              id="cancel-membership-button"
              key="cancel"
              type="secondary"
              style={{ borderColor: "blue", color: "blue" }}
              className="mx-4 px-10"
              onClick={closeModal}
            >
              Cancel
            </Button>
            <Button
              id="create-membership-button"
              key="submit"
              type="primary"
              loading={isCreateMembershipSubmitting}
              style={{ backgroundColor: "green", color: "white" }}
              className="mx-4 px-10"
              onClick={formik.handleSubmit}
              disabled={disabled}
            >
              {disabled ? <Spin /> : "Create"}
            </Button>
            <Button
              id="list-membership-button"
              key="list"
              type="primary"
              className="ml-4 mr-8 px-10"
              onClick={openListNowModal}
              disabled={disabled}
            >
              {disabled ? <Spin /> : "List Now"}
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
                    formik.setFieldValue(
                      "additionalInformation",
                      e.target.value
                    );
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
            <Typography.Title level={5}>Services</Typography.Title>
            <Button
              className="w-80"
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => {
                addServiceRow();
                memberDiscount.push(1);
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
                        serviceId: services.find(
                          (service) => service.name === value
                        ).address,
                      };
                      formik.setFieldValue("services", updatedServices);
                    }}
                    value={service.serviceName}
                  >
                    {/* TODO: We should think about how we want to load services. If its a long list it might not be the best way to display them this way. */}
                    {isservicesLoading === false &&
                      services.map((service) => (
                        <Select.Option
                          key={service.address}
                          value={service.name}
                        >
                          {service.name}
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
                <div className="col-span-2 flex flex-col items-center">
                  <Radio.Group
                    defaultValue={1}
                    buttonStyle="solid"
                    className="col-span-2"
                    size="small"
                  >
                    <Radio.Button
                      value={1}
                      onClick={() => {
                        handlePriceDiscountClick(index);
                      }}
                    >
                      Discount Price
                    </Radio.Button>
                    <Radio.Button
                      value={2}
                      onClick={() => {
                        handlePercentDiscountClick(index);
                      }}
                    >
                      Discount Percent
                    </Radio.Button>
                  </Radio.Group>
                  <Form.Item
                    name={`memberPrice_${index}`}
                    key={`memberPrice_${index}`}
                    className="mt-2"
                  >
                    <InputNumber
                      id={`memberPrice_${index}`}
                      name={`memberPrice_${index}`}
                      type="number"
                      min={0}
                      value={service.memberPrice}
                      onChange={(value) => {
                        const updatedServices = [...formik.values.services];
                        updatedServices[index] = {
                          ...updatedServices[index],
                          memberPrice: value,
                          percentDiscount: value, // Update both fields with the same value later on we will remove the one that is not being used
                        };
                        formik.setFieldValue("services", updatedServices);
                      }}
                      className="w-10/12"
                      addonBefore={memberDiscount[index] === 1 ? "$" : "%"}
                    />
                  </Form.Item>
                </div>
                <Button
                  className="w-10/12 self-end"
                  key={`removeService_${index}`}
                  type="primary"
                  icon={<MinusOutlined />}
                  onClick={() => {
                    removeServiceRow();
                    memberDiscount.pop();
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
      {visible && (
        <ListNowModal
          open={visible}
          user={user}
          handleCancel={closeListNowModal}
          onClick={openListNowModal}
          formik={formik}
          isCreateMembershipSubmitting={isCreateMembershipSubmitting}
        />
      )}
      {/* {message && openToast("bottom")} */}
    </>
  );
};

export default CreateMembershipModal;
