import React, { useEffect, useState } from "react";
import { useFormik, getIn } from "formik";
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
  Card,
  Row,
  Col,
  Space,
  Image,
} from "antd";
import { PlusOutlined, InboxOutlined, MinusOutlined, CaretDownOutlined, CheckCircleOutlined, DeleteOutlined } from "@ant-design/icons";
import getSchema from "./MembershipSchema";
import { listNowConfig } from "../MarketPlace/listNowConfig";
// import useDebounce from "../UseDebounce";

// Actions for the membership context
import { actions } from "../../contexts/membership/actions";
import { actions as prodActions } from "../../contexts/product/actions";
import {
  useMembershipDispatch,
  useMembershipState,
} from "../../contexts/membership";
import { useProductDispatch, useProductState } from "../../contexts/product";
import { actions as subCategoryActions } from "../../contexts/subCategory/actions";
import { actions as serviceActions } from "../../contexts/service/actions";
import { actions as inventoryActions } from "../../contexts/inventory/actions";

import { useServiceState, useServiceDispatch } from "../../contexts/service";
import {
  useSubCategoryDispatch,
  useSubCategoryState,
} from "../../contexts/subCategory";
import { useInventoryDispatch } from "../../contexts/inventory";
import ListNowModal from "./ListNowModal";
import { INVENTORY_STATUS } from "../../helpers/constants";
import { checkPrimary, checkSuccess, uploadIcon2, uploadImageIcon } from "../../images/SVGComponents"
const { Text, Title } = Typography;

const { Dragger } = Upload;

const discountType = [
  { label: "$", value: "price" },
  { label: "%", value: "percent" }
]

const CreateMembershipModal = ({ open, handleCancel, user }) => {
  // const schema = getSchema();
  const prodDispatch = useProductDispatch();
  const limit = 10;
  // Can update these values for service search later on
  const [offset, setOffset] = useState(0);
  const dispatch = useMembershipDispatch();
  const [listModalConfig, setListModalConfig] = useState({})
  const [previewImage, setPreviewImage] = useState("");
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [imageList, setImageList] = useState([]);
  const [fileList, setFileList] = useState([]);
  const [memberDiscount, setMemberDiscount] = useState([1]);
  const [visible, setVisible] = useState(false);
  const {
    isCreateProductSubmitting,
    isuploadImageSubmitting,
    isCreateMembershipSubmitting,
  } = useMembershipState();
  const { services, isServicesLoading } = useServiceState();
  const { subCategorys, issubCategorysLoading } = useSubCategoryState();

  // Dispatch for the membership context
  const serviceDispatch = useServiceDispatch();
  const subCategoryDispatch = useSubCategoryDispatch();
  const inventoryDispatch = useInventoryDispatch();

  const queryValue = user.user.organization;

  // TODO: We should probably only query services made by the user's organization
  useEffect(() => {
    serviceActions.fetchService(serviceDispatch, limit, offset, queryValue);
    subCategoryActions.fetchSubCategory(subCategoryDispatch, "Membership");
  }, []);

  const initialValues = {
    name: "",
    subCategory: "",
    duration: "",
    additionalInformation: "",
    images: [],
    description: "",
    price: "",
    quantity: "",
    isTaxPercentage: false,
    taxDollarAmount: 0,
    taxPercentageAmount: 0,
    taxPercentage: 0,
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
    validationSchema: getSchema(visible),
    // setFieldValue: (field, value) => {
    //   formik.setFieldValue(field, value);
    // },
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

  const handleDiscountType = (type, index) => {
    let updatedMemberDiscount = [...memberDiscount];
    if (type === "Percent") {
      updatedMemberDiscount[index] = 2;
    } else {
      updatedMemberDiscount[index] = 1;
    }
    setMemberDiscount(updatedMemberDiscount);
  }

  const selectAfter = (index) => {
    return <Select defaultValue="$" onChange={(e) => { handleDiscountType(e, index) }} style={{ width: 60 }} options={discountType} />
  }

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
      memberPrice: null,
      percentDiscount: null,
    });
    formik.setFieldValue("services", updatedServices);
  };

  const removeServiceRow = (indexToRemove) => {
    const updatedServices = [...formik.values.services];
    updatedServices.splice(indexToRemove, 1);
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

    const calculateMemberPrice = (membershipName, memberDiscount) => {
      const servicePrice = services.find(
        (service) => service.name === membershipName
      ).price;

      const memberPrice = servicePrice * (1 - memberDiscount / 100);

      return memberPrice;
    };

    const calculateMemberDiscount = (membershipName, memberPrice) => {
      const servicePrice = services.find(
        (service) => service.name === membershipName
      ).price;

      const memberDiscount = (1 - memberPrice / servicePrice) * 100;

      return memberDiscount;
    };


    Promise.all(uploadFilePromises)
      .then(async (results0) => {
        arrayOfFiles.push(...results0);
        Promise.all(uploadImagePromises)
          .then(async (results) => {
            arrayOfImageData.push(...results);

            const allFiles = arrayOfFiles.concat(arrayOfImageData);

            // Your code for when all images have been uploaded
            console.log("all images uploaded");
            // TODO: Add image and file upload to S3
            const body = {
              membershipArgs: {
                name: updatedValues.name,
                description: updatedValues.description,
                manufacturer: user.user.organization,
                unitOfMeasurement: 6,
                // Generate random code for now
                userUniqueMembershipCode: `U-ID-${Math.floor(Math.random() * 1000000)}`,
                // Generate random number for now
                uniqueMembershipCode: Math.floor(Math.random() * 1000000),
                leastSellableUnit: 1,
                // TODO: This should be updated later on to use the image key from S3. This might have to be changed into an array.
                imageKey: updatedValues.images[0].name,
                category: "Membership",
                subCategory: updatedValues.subCategory,
                createdDate: new Date().getTime(),
                timePeriodInMonths: updatedValues.duration,
                additionalInfo: updatedValues.additionalInformation,
                // If visible is true the List Now form is open and the membership is active
                isActive: true,
              },
              membershipServiceArgs: updatedValues.services.map((service) => ({
                serviceId: service.serviceId,
                membershipPrice: service.memberPrice ? service.memberPrice : calculateMemberPrice(service.serviceName, service.percentDiscount),
                discountPrice: service.percentDiscount ? service.percentDiscount : calculateMemberDiscount(service.serviceName, service.memberPrice),
                maxQuantity: service.numberOfUses,
                createdDate: new Date().getTime(),
                // If visible is true the List Now form is open and the membership is active
                isActive: true,
              })),
              //TODO: where do I put the imageKey from the uploaded File?
              productFileArgs: allFiles.map((file, index) => ({
                fileLocation: `${file.imageKey}`,
                fileHash: `${file.docHash}`,
                fileName: `${file.originalName}`,
                uploadDate: new Date().getTime(),
                createdDate: new Date().getTime(),
                currentSection: 1,
                currentType: 2,
              })),
            };
            switch (visible) {
              // If the List Now form is open we will create the membership and inventory otherwise we will just create the membership
              case false:
                const isDone = await actions.createMembership(dispatch, body);
                if (isDone) {
                  formik.resetForm();
                  handleCancel("success");
                }
                break;
              case true:
                const createMembership = await actions.createMembership(dispatch, body);

                const productId = createMembership.productAddress;
                const inventoryBody = {
                  productAddress: productId,
                  quantity: updatedValues.quantity,
                  pricePerUnit: updatedValues.price,
                  // Generate random code for now
                  batchId: `B-ID-${Math.floor(Math.random() * 1000000)}`,
                  // Status should always be published if we use List Now
                  status: INVENTORY_STATUS.PUBLISHED,
                  serialNumber: [],
                  taxPercentageAmount: updatedValues.taxPercentageAmount,
                  taxDollarAmount: updatedValues.taxDollarAmount,
                };

                const createInventory = await inventoryActions.createInventory(
                  inventoryDispatch,
                  inventoryBody
                );
                if (createInventory) {
                  formik.resetForm();
                  handleCancel("success");
                }
                break;
              default:
                break;
            }
          })
          .catch((e) => {
            console.log("Inner promise", e);
          });
      })
      .catch((e) => {
        console.log("Outer promise", e);
      });
  };

  const disabled = isCreateProductSubmitting || isuploadImageSubmitting;

  const closeModal = () => {
    handleCancel(false);
  };

  function beforeUpload() {
    return false;
  }

  const closeListNowModal = () => {
    setVisible(false);
  };

  const openListNowModal = () => {
    setVisible(true);
  };

  const handleInputChange = (name, event) => {
    formik.setFieldValue(name, event.target.value);
  };

  const handleChange = (info) => {
    setFileList(info.fileList);
  };

  const handleRemove = (file) => {
    const newFileList = fileList.filter((f) => f.uid !== file.uid);
    setFileList(newFileList);
  };

  const uploadText = (props) => {
    return (
      <>
        <div className="ant-upload-drag-icon mb-8 flex justify-center ">
          {props}
        </div>
        <div className="w-52 mx-auto">
          <Text className="ant-upload-text">Drag & Drop or </Text>
          <Text className="primary" style={{ color: "#181EAC" }} strong>Browse Files</Text>
        </div>
      </>
    )
  }
  const isDisabled = !formik.isValid || !formik.dirty;

  return (
    <>
      <Modal
        open={open}
        centered
        onCancel={closeModal}
        width={'100%'}
        className="create-new-modal mt-14"
        footer={[
          <Row className="mt-8 create-modal-footer-shadow">
            <Col span={8} className="flex justify-center mx-auto mt-4 py-5">
              {/* <Button
                id="cancel-membership-button"
                key="cancel"
                type="secondary"
                style={{ borderColor: "blue", color: "blue" }}
                className="mx-4 px-10"
                onClick={closeModal}
              >
                Cancel
              </Button> */}
              <Button
                id="create-membership-button"
                key="submit"
                type="primary"
                size="large"
                loading={isCreateMembershipSubmitting}
                style={{ backgroundColor: "green", color: "white" }}
                className="mx-4 px-10 font-bold w-56"
                onClick={formik.handleSubmit}
                disabled={disabled}
              >
                {disabled ? <Spin /> : "Create"}
              </Button>
              <Button
                id="list-membership-button"
                key="list"
                size="large"
                type={isDisabled ? "default" : "primary"}
                className="ml-4 mr-8 px-10 font-bold w-56"
                onClick={openListNowModal}
                disabled={isDisabled}
              >
                {disabled ? <Spin /> : "List Now"}
              </Button>
            </Col>
          </Row>,
        ]}
      >

        <Row >
          <Col className="rounded h-22 w-full" style={{ backgroundColor: "#f2f2f2" }} span={24}>
            <Title level={3} className="p-2 mt-3 text-center" >Create New Membership</Title>
          </Col>
        </Row>
        <Row>
          <Col sm={24} md={18} xl={12} className="mx-auto" >
            <Form layout="vertical" className="mt-5">

              <Card className="mt-8 shadow-md">
                <Row className="flex">{checkPrimary()} &nbsp; &nbsp; <Title level={4} className="leading-6"> Membership Details</Title></Row>
                <Col className="mt-4">
                  <Row gutter={[12, 12]}>
                    <Col span={8}>
                      <Form.Item label="Membership Name" name="name">
                        <Input
                          id="name"
                          name="name"
                          type="text"
                          size="large"
                          // placeholder="Membership Name"
                          onChange={(e) => {
                            // formik.setFieldValue("name", e.target.value);
                            handleInputChange("name", e)
                          }}
                          value={formik.values.name}
                        />
                        {getIn(formik.touched, "name") &&
                          getIn(formik.errors, "name") && (
                            <span className="text-error text-xs">
                              {getIn(formik.errors, "name")}
                            </span>
                          )}
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item
                        label="Sub Category"
                        name="subCategory"
                      >
                        <Select
                          id="subCategory"
                          name="subCategory"
                          // placeholder="Select Sub Category"
                          size="large"
                          suffixIcon={issubCategorysLoading ? <Spin /> : <CaretDownOutlined />}
                          onChange={(value) => {
                            formik.setFieldValue("subCategory", value);
                          }}
                          value={formik.values.category}
                        >
                          {!issubCategorysLoading &&
                            subCategorys.map((subCategory) => (
                              <Select.Option
                                key={subCategory.name}
                                value={subCategory.name}
                              >
                                {subCategory.name}
                              </Select.Option>
                            ))}
                        </Select>
                        {getIn(formik.touched, "subCategory") &&
                          getIn(formik.errors, "subCategory") && (
                            <span className="text-error text-xs">
                              {getIn(formik.errors, "subCategory")}
                            </span>
                          )}
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item label="Duration (Months)" name="duration">
                        <InputNumber
                          id="duration"
                          name="duration"
                          // placeholder="Duration"
                          type="number"
                          size="large"
                          min={0}
                          controls={false}
                          value={formik.values.duration}
                          onChange={(value) => {
                            formik.setFieldValue("duration", value);
                          }}
                          className="w-full"
                        />
                        {getIn(formik.touched, "duration") &&
                          getIn(formik.errors, "duration") && (
                            <span className="text-error text-xs">
                              {getIn(formik.errors, "duration")}
                            </span>
                          )}
                      </Form.Item>
                    </Col>
                  </Row>

                  <Row>
                    <Col span={24} className="mt-2">
                      <Form.Item
                        label="Additional Information"
                        name="additionalInformation"
                      // className="col-span-2"
                      >
                        <Input.TextArea
                          id="additionalInformation"
                          name="additionalInformation"
                          // placeholder="Additional Information"
                          type="text"
                          size="large"
                          onChange={(e) => {
                            formik.setFieldValue(
                              "additionalInformation",
                              e.target.value
                            );
                          }}
                          value={formik.values.additionalInformation}
                        />
                        {getIn(formik.touched, "additionalInformation") &&
                          getIn(formik.errors, "additionalInformation") && (
                            <span className="text-error text-xs">
                              {getIn(formik.errors, "additionalInformation")}
                            </span>
                          )}
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row>
                    <Col span={24} className="mt-2">
                      <Form.Item label="Description" name="description">
                        <Input.TextArea
                          id="description"
                          name="description"
                          type="text"
                          size="large"
                          // placeholder="Description"
                          onChange={(e) => {
                            formik.setFieldValue("description", e.target.value);
                          }}
                          value={formik.values.description}
                          className=""
                        />
                        {getIn(formik.touched, "description") &&
                          getIn(formik.errors, "description") && (
                            <span className="text-error text-xs">
                              {getIn(formik.errors, "description")}
                            </span>
                          )}
                      </Form.Item>
                    </Col>
                  </Row>
                </Col>
              </Card>


              <Card className="mt-5 shadow-md">
                <Row className="flex">{checkPrimary()} &nbsp; &nbsp; <Title level={4} className="leading-6" > Upload Photos</Title></Row>
                <Upload
                  id="images"
                  listType="picture"
                  multiple={true}
                  fileList={imageList}
                  onPreview={handlePreview}
                  onChange={handleImageChange}
                  beforeUpload={beforeUpload}
                  accept="image/png, image/webp, image/jpeg"
                >
                  {/* {imageList.length >= 10 ? null : uploadButton} */}
                  {uploadText(uploadImageIcon())}
                </Upload>

                {getIn(formik.touched, "images") &&
                  getIn(formik.errors, "images") && (
                    <span className="text-error text-xs">
                      {getIn(formik.errors, "images")}
                    </span>
                  )}

              </Card>


              <Card className="mt-5 shadow-md">
                <Row>
                  <Col span={12}>
                    <Row className="flex">{checkPrimary()} &nbsp; &nbsp; <Title level={4} className="leading-6"> Services</Title></Row>
                  </Col>
                  <Col span={12}> <Button
                    className=" float-right font-bold"
                    style={{ color: 'blue' }}
                    type="text"
                    size="large"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      addServiceRow();
                      memberDiscount.push(1);
                    }}
                  >
                    Add Service
                  </Button> </Col>
                </Row>
                {formik.values.services.map((service, index) => (
                  <Row className="mt-2" gutter={[12, 12]} key={index}>
                    <Col span={7}>
                      <Form.Item
                        label="Service Name"
                        name={`serviceName_${index}`}
                        key={`serviceName_${index}`}
                        value={formik.values.services[index].serviceName}
                      >
                        <Select
                          id={`serviceName_${index}`}
                          name={`serviceName_${index}`}
                          size="large"
                          // placeholder="Select Service"
                          suffixIcon={isServicesLoading ? <Spin /> : <CaretDownOutlined />}
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
                          {isServicesLoading === false &&
                            services.map((service) => (
                              <Select.Option
                                key={service.address}
                                value={service.name}
                              >
                                {service.name}
                              </Select.Option>
                            ))}
                        </Select>
                        {getIn(formik.touched, `services[${index}].serviceName`) &&
                          getIn(formik.errors, `services[${index}].serviceName`) && (
                            <span className="text-error text-xs">
                              {getIn(formik.errors, `services[${index}].serviceName`)}
                            </span>
                          )}
                      </Form.Item>
                    </Col>
                    <Col span={7}>
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
                          size="large"
                          // placeholder="Number of Uses"
                          min={0}
                          className="w-full"
                          controls={false}
                          value={service.numberOfUses}
                          onChange={(value) => {
                            const updatedServices = [...formik.values.services];
                            updatedServices[index] = {
                              ...updatedServices[index],
                              numberOfUses: value,
                            };
                            formik.setFieldValue("services", updatedServices);
                          }}

                        />
                        {getIn(formik.touched, `services[${index}].numberOfUses`) &&
                          getIn(formik.errors, `services[${index}].numberOfUses`) && (
                            <span className="text-error text-xs">
                              {getIn(formik.errors, `services[${index}].numberOfUses`)}
                            </span>
                          )}
                      </Form.Item>
                    </Col>

                    <Col span={7}>
                      <Form.Item
                        label='Discount'
                        name={`memberPrice_${index}`}
                        key={`memberPrice_${index}`}
                      >
                        <InputNumber
                          id={`memberPrice_${index}`}
                          name={`memberPrice_${index}`}
                          // placeholder="Discount"
                          type="number"
                          size="large"
                          addonAfter={<Row className="flex w-16 h-8 border-grey rounded-md justify-between cursor-pointer">
                            <Col span={12} className="p-1"
                              style={{ backgroundColor: memberDiscount[index] == 2 ? "#F2F2F5" : "" }}
                              onClick={() => { handleDiscountType("Percent", index) }}>
                              %
                            </Col>
                            <Col span={12} className="p-1"
                              style={{ backgroundColor: memberDiscount[index] != 2 ? "#F2F2F5" : "" }}
                              onClick={() => { handleDiscountType("Dollar", index) }}>
                              $
                            </Col>
                          </Row>}
                          controls={false}
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

                        // addonBefore={memberDiscount[index] === 1 ? "$" : "%"}
                        />
                        {/* We should throw the formik error to say we need either the discount price or  */}
                        {getIn(formik.touched, `services[${index}].memberPrice`) &&
                          getIn(formik.errors, `services[${index}].memberPrice`) && (
                            <span className="text-error text-xs">
                              {getIn(formik.errors, `services[${index}].memberPrice`)}
                            </span>
                          )}
                      </Form.Item>
                    </Col>
                    {/* </div> */}
                    <Col span={3}>
                      <Button
                        className="self-end mt-7 float-right"
                        key={`removeService_${index}`}
                        type="primary"
                        size="large"
                        icon={<MinusOutlined />}
                        onClick={() => {
                          removeServiceRow();
                          memberDiscount.splice(index, 1);
                        }}
                      ></Button>
                    </Col>
                  </Row>
                ))}
              </Card>

              <Card className="mt-5 shadow-md">
                <Row className="flex">{checkPrimary()} &nbsp; &nbsp; <Title level={4} className="leading-6"> Upload Documents</Title></Row>
                <Row className="mt-5">
                  <Col span={24}>
                    <Upload.Dragger
                      {...props}
                      fileList={fileList}
                      // onChange={handleChange}
                      showUploadList={false}
                    >
                      {uploadText(uploadIcon2())}
                    </Upload.Dragger>
                  </Col>
                </Row>

                {fileList.length > 0 && <Card className="mt-5 shadow-lg">
                  <Row gutter={16}>
                    {fileList.map((file, index) => (
                      <Col span={12} key={index}>
                        <Row className="border h-10 p-2 rounded border-indigo-600" gutter={[12, 12]}>
                          <Col span={20}>{file.name}</Col>
                          <Col span={4}>
                            {/* <Button
                          className="float-right"
                          type="link"
                          icon={<DeleteOutlined />}
                          onClick={() => handleRemove(file)}
                        /> */}
                            <span className="float-right">{checkSuccess()}</span>
                          </Col>
                        </Row>
                      </Col>
                    ))}
                  </Row>
                </Card>}
              </Card>

            </Form>
          </Col>
        </Row>
      </Modal>
      {visible && (
        <ListNowModal
          config={listNowConfig("create")}
          open={visible}
          user={{ user }}
          handleCancel={closeListNowModal}
          onClick={openListNowModal}
          formik={formik}
          id="None"
          getIn={getIn}
          isCreateMembershipSubmitting={isCreateMembershipSubmitting}
        />
      )}
    </>
  );
};

export default CreateMembershipModal;
