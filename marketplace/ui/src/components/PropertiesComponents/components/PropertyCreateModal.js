import React, { useState } from "react";
import {
  Modal,
  Form,
  Divider,
  Input,
  InputNumber,
  Select,
  notification,
  Checkbox,
  Collapse,
  Col,
  Row,
  Button,
  Typography,
} from "antd";

import {
  ArrowLeftOutlined,
} from "@ant-design/icons";

import {
  categoriesObj,
  stateData,
  homeTypeData,
  propertyCheckBox,
  propertyConstants,
} from "../helpers/constants";
import PropertyCreateConfirmModal from "./PropertyCreateConfirmModal";
import { actions } from "../../../contexts/propertyContext/actions";
import {
  usePropertiesDispatch,
  usePropertiesState,
} from "../../../contexts/propertyContext";
const { LIMIT_PER_PAGE } = propertyConstants;
const { Panel } = Collapse;
const { Option } = Select;
const { Text } = Typography;

// const getBase64 = (file) =>
//   new Promise((resolve, reject) => {
//     const reader = new FileReader();
//     reader.readAsDataURL(file);
//     reader.onload = () => resolve(reader.result);
//     reader.onerror = (error) => reject(error);
//   });

function PropertyCreateModal({
  isCreateModalOpen,
  toggleCreateModal,
}) {
  const [modalView, setModalView] = useState(true);
  const [isCreateConfirmModalOpen, toggleCreateConfirmModal] = useState(false);

  const [api, contextHolder] = notification.useNotification();
  const dispatch = usePropertiesDispatch();

  const { message, success, isCreatePropertySubmitting } = usePropertiesState();
  const [propertyData, setPropertyData] = useState({
    lotSizeUnits: "sqft",
    livingAreaUnits: "sqft",
    numberOfUnitsTotal: 1,
  });

  const [selectedOptions, setSelectedOptions] = useState(propertyCheckBox);

  //TODO:- Can uncomment when use image upload ***
  // const [selectedImage, setSelectedImage] = useState(null);
  // const [previewOpen, setPreviewOpen] = useState(false);
  // const [previewImage, setPreviewImage] = useState("");
  // const [previewTitle, setPreviewTitle] = useState("");
  // const [fileList, setFileList] = useState([]);

  const {
    title,
    description,
    listPrice,
    streetName,
    streetNumber,
    unitNumber,
    postalCity,
    stateOrProvince,
    postalcode,

    propertyType,
    bedroomsTotal,
    bathroomsTotalInteger,
    livingArea,
    lotSizeArea,
    numberOfUnitsTotal,

    lotSizeUnits,
    livingAreaUnits,
  } = propertyData;

  const isDisabledCreateView =
    !title ||
    !description ||
    !listPrice ||
    !streetName ||
    !streetNumber ||
    !unitNumber ||
    !postalCity ||
    !stateOrProvince ||
    !postalcode;

  const isDisabledFactsView =
    !propertyType ||
    !bedroomsTotal ||
    !bathroomsTotalInteger ||
    !livingArea ||
    !lotSizeArea;

  const LivingAreaUnitElement = (
    <Select defaultValue={livingAreaUnits}>
      <Option value={livingAreaUnits}>{livingAreaUnits}</Option>
    </Select>
  );
  const LotSizeAreaUnitElement = (
    <Select defaultValue={lotSizeUnits}>
      <Option value={lotSizeUnits}>{livingAreaUnits}</Option>
    </Select>
  );

  const handleModalToggle = () => {
    setModalView(!modalView);
  };

  const showConfirmationModal = () => {
    toggleCreateConfirmModal(!isCreateConfirmModalOpen);
  };

  const handleChange = (key, value) => {
    let data = { ...propertyData };
    data[key] = value;
    setPropertyData(data);
  };

  // TODO: Uncomment when it's required
  // function beforeUpload(file) {
  //   const isJpgOrPng = file.type === "image/jpeg" || file.type === "image/png";
  //   if (!isJpgOrPng) {
  //     openToast("bottom", "Image must be of jpeg or png format");
  //   }
  //   const isLt1M = file.size / 1024 / 1024 < 1;
  //   if (!isLt1M) {
  //     openToast("bottom", "Cannot upload an image of size more than 1mb");
  //   }
  //   return isJpgOrPng && isLt1M;
  // }

  //creates the listing for property
  const handleSubmitCreateProperty = async () => {

    const body = {
      title,
      description,
      propertyType,
      listPrice,
      streetNumber,
      streetName,
      unitNumber,
      postalCity,
      stateOrProvince,
      postalcode,
      bathroomsTotalInteger,
      bedroomsTotal,
      lotSizeArea,
      lotSizeUnits,
      livingArea,
      livingAreaUnits,
      numberOfUnitsTotal,

      ...selectedOptions,
    };

    // let [productContractRest, productContractAddress, propertyContractRest, propertyContractAddress] = await actions.createProperty(dispatch, body);
    let response = await actions.createProperty(dispatch, body);
    if (response) {
      toggleCreateModal(false)
      toggleCreateConfirmModal(false)
      setModalView(!modalView);
      actions.fetchProperties(dispatch, LIMIT_PER_PAGE, 0)
    }

    //TODO:- Can uncomment when use image upload ***
    //   if (projectImages) {
    //     const formData = new FormData()
    //     formData.append('projectAddress', projectAddress)
    //     formData.append('section', uploadSections.IMAGES)
    //     projectImages.forEach((file) => {
    //       formData.append('projectImageFiles', file.originFileObj);
    //     });
    //     await ProjectDocumentActions.uploadProjectDocument(projectDocumentDispatch, formData);
    //   }
    //   Modal.destroyAll();
  };

  //TODO:- Can uncomment when use image upload ***
  // const handleCancel = () => setPreviewOpen(false);
  // const handlePreview = async (file) => {
  //   if (!file.url && !file.preview) {
  //     file.preview = await getBase64(file.originFileObj);
  //   }
  //   setPreviewImage(file.url || file.preview);
  //   setPreviewOpen(true);
  //   setPreviewTitle(
  //     file.name || file.url.substring(file.url.lastIndexOf("/") + 1)
  //   );
  // };
  // const handleFileChange = ({ fileList: newFileList }) => {
  //   setFileList(newFileList);
  // }

  const primaryAction = {
    content: modalView ? (
      "Create a Property Listing"
    ) : (
      <>
        <Button type="link" onClick={handleModalToggle}>
          <ArrowLeftOutlined />
        </Button>
        <Text>Property Listing - House Facts</Text>
      </>
    ),
    disabled: modalView ? isDisabledCreateView : isDisabledFactsView,
    onToggle: handleModalToggle,
    onConfirm: showConfirmationModal
  };

  const openToast = (placement) => {
    if (success) {
      api.success({
        message: message,
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: message,
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 2,
      });
    }
  };

  const handleCheckbox = (value, check) => {
    let data = { ...selectedOptions };
    data[value] = check;
    setSelectedOptions(data);
  };

  function convertCategories() {
    const convertedData = [];
    for (const category in categoriesObj) {
      if (categoriesObj.hasOwnProperty(category)) {
        convertedData.push({
          header: category.charAt(0).toUpperCase() + category.slice(1).replace('_', ' '),
          options: categoriesObj[category],
          keyName: category,
        });
      }
    }

    return convertedData;
  }

  const collapseData = convertCategories();

  const formStepFirst = () => {
    return (
      <Form name="basic" layout="vertical">
        <Form.Item
          label="Listing Title"
          name="title"
          rules={[
            { required: true, message: "Please enter project title." },
          ]}
        >
          <Input
            label="title"
            // value={title}
            maxLength={100}
            placeholder="Listing Title"
            showCount
            onChange={(e) => {
              handleChange("title", e.target.value);
            }}
          />
        </Form.Item>
        <Form.Item
          label="Project Description"
          name="description"
          rules={[
            {
              required: true,
              message: "Please enter project description.",
            },
          ]}
        >
          <Input.TextArea
            label="Project Description"
            value={description}
            maxLength={5000}
            showCount
            placeholder="Project Description"
            onChange={(e) => {
              handleChange("description", e.target.value);
            }}
          />
        </Form.Item>

        <Row>
          <Col span={11}>
            <Form.Item
              label="Total Units"
              name="totalUnits"
              rules={[
                { required: true, message: "Please enter total units." },
              ]}
            >
              <InputNumber
                style={{ width: "100%" }}
                label="Total Units"
                id="numberOfUnitsTotal"
                type="Number"
                placeholder="Total Units"
                controls={false}
                value={numberOfUnitsTotal}
                onChange={(value) => {
                  handleChange("numberOfUnitsTotal", value);
                }}
                onWheel={(e) => {
                  e.target.blur();
                }}
              />
            </Form.Item>
          </Col>
          <Col span={12} offset={1}>
            <Form.Item
              label="Asking Price"
              name="listPrice"
              rules={[
                { required: true, message: "Please enter asking price." },
              ]}
            >
              <InputNumber
                style={{ width: "100%" }}
                precision={0}
                label="Asking Price"
                type="Number"
                min={0}
                placeholder="Asking Price"
                controls={false}
                addonBefore="$"
                value={listPrice}
                onChange={(e) => {
                  handleChange("listPrice", e);
                }}
                onWheel={(e) => {
                  e.target.blur();
                }}
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          label="Street Name"
          name="streetName"
          rules={[{ required: true, message: "Please enter street name." }]}
        >
          <Input
            label="Street Name"
            id="streetname"
            placeholder="Street Name"
            value={streetName}
            onChange={(e) => {
              handleChange("streetName", e.target.value);
            }}
          />
        </Form.Item>
        <Row>
          <Col span={11}>
            <Form.Item
              label="Street Number"
              name="streetNumber"
              rules={[
                { required: true, message: "Please enter street number." },
              ]}
            >
              <InputNumber
                style={{ width: "100%" }}
                label="Street Number"
                id="streetnumber"
                type="Number"
                placeholder="Street Number"
                controls={false}
                value={streetNumber}
                onChange={(value) => {
                  handleChange("streetNumber", value);
                }}
                onWheel={(e) => {
                  e.target.blur();
                }}
              />
            </Form.Item>
          </Col>
          <Col span={12} offset={1}>
            <Form.Item
              label="House Number"
              name="houseNumber"
              rules={[
                { required: true, message: "Please enter house number." },
              ]}
            >
              <Input
                style={{ width: "100%" }}
                label="House Number"
                id="housenumber"
                placeholder="House Number"
                controls={false}
                value={unitNumber}
                onChange={(e) => {
                  handleChange("unitNumber", e.target.value);
                }}
                onWheel={(e) => {
                  e.target.blur();
                }}
              />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          label="State"
          name="state"
          rules={[{ required: true, message: "Please select state" }]}
        >
          <Select
            label="State"
            value={stateOrProvince}
            placeholder="Select State"
            onSelect={(e) => {
              handleChange("stateOrProvince", e);
            }}
            options={stateData}
            showSearch
          />
        </Form.Item>
        <Row>
          <Col span={11}>
            <Form.Item
              label="City"
              name="city"
              rules={[{ required: true, message: "Please enter a city." }]}
            >
              <Input
                label="City"
                id="city"
                placeholder="City"
                value={postalCity}
                onChange={(e) => {
                  handleChange("postalCity", e.target.value);
                }}
              />
            </Form.Item>
          </Col>
          <Col span={12} offset={1}>
            <Form.Item
              label="Zip Code"
              name="postalcode"
              rules={[
                { required: true, message: "Please enter a zip code." },
              ]}
            >
              <InputNumber
                precision={0}
                style={{ width: "100%" }}
                label="Zip Code"
                type="Number"
                placeholder="ZipCode"
                min={0}
                max={99999}
                controls={false}
                value={postalcode}
                onChange={(value) => {
                  handleChange("postalcode", value);
                }}
                onWheel={(e) => {
                  e.target.blur();
                }}
              />
            </Form.Item>
          </Col>
        </Row>

        {/* <Form.Item label="Upload Image" name="image">
              <div className="w-48 h-36 p-4 border-secondryD border rounded flex flex-col justify-around">
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
            </Form.Item> */}
      </Form>
    )
  }

  const formStepSec = () => {
    return (
      <Form name="basic" layout="vertical">
        <Form.Item
          label="Home Type"
          name="homeType"
          rules={[
            { required: true, message: "Please Select Home Type." },
          ]}
        >
          <Select
            label="homeType"
            placeholder="Property Type"
            value={propertyType}
            onSelect={(value) => {
              handleChange("propertyType", value);
            }}
            options={homeTypeData}
            showSearch
          />
        </Form.Item>
        <Row>
          <Col span={11}>
            <Form.Item
              label="Bedrooms"
              name="bedrooms"
              rules={[
                {
                  required: true,
                  message: "Please enter number of bedrooms.",
                },
              ]}
            >
              <InputNumber
                style={{ width: "100%" }}
                precision={0}
                label="bedrooms"
                placeholder="Bedrooms"
                type="Number"
                controls={false}
                min={0}
                value={bedroomsTotal}
                onChange={(value) => {
                  handleChange("bedroomsTotal", value);
                }}
                onWheel={(e) => {
                  e.target.blur();
                }}
              />
            </Form.Item>
          </Col>
          <Col span={12} offset={1}>
            <Form.Item
              label="Bathrooms"
              name="bathrooms"
              rules={[
                {
                  required: true,
                  message: "Please enter number of bathrooms",
                },
              ]}
            >
              <InputNumber
                style={{ width: "100%" }}
                precision={0}
                label="bathrooms"
                placeholder="Bathrooms"
                type="Number"
                controls={false}
                min={0}
                value={bathroomsTotalInteger}
                onChange={(value) => {
                  handleChange("bathroomsTotalInteger", value);
                }}
                onWheel={(e) => {
                  e.target.blur();
                }}
              />
            </Form.Item>
          </Col>
        </Row>
        <Row>
          <Col span={11}>
            <Form.Item
              label="Living Area"
              name="livingArea"
              rules={[
                { required: true, message: "Please enter square feet" },
              ]}
            >
              <InputNumber
                precision={0}
                label="Living Area"
                placeholder="Living Area"
                type="Number"
                controls={false}
                addonAfter={LivingAreaUnitElement}
                min={0}
                value={livingArea}
                onChange={(value) => {
                  handleChange("livingArea", value);
                }}
                onWheel={(e) => {
                  e.target.blur();
                }}
              />
            </Form.Item>
          </Col>
          <Col span={12} offset={1}>
            <Form.Item
              label="Lot Size Area"
              name="lotSize"
              rules={[
                {
                  required: true,
                  message: "Please enter an asking price.",
                },
              ]}
            >
              <InputNumber
                style={{ width: "100%" }}
                precision={0}
                label="lotSize"
                placeholder="Lot Size Area"
                type="Number"
                controls={false}
                addonAfter={LotSizeAreaUnitElement}
                min={0}
                value={lotSizeArea}
                onChange={(value) => {
                  handleChange("lotSizeArea", value);
                }}
                onWheel={(e) => {
                  e.target.blur();
                }}
              />
            </Form.Item>
          </Col>
        </Row>

        <Collapse
          expandIconPosition={"end"}
          defaultActiveKey={[]}
          style={{ margin: "10px 0px" }}
        >
          {collapseData.map((item, index) => {
            return (
              <Panel
                style={{ fontWeight: 700 }}
                header={item.header}
                key={index}
              >
                {item.options.map((opt, key) => {
                  return (
                    <Checkbox
                      key={key}
                      name={opt.label}
                      onChange={(e) => {
                        handleCheckbox(opt.value, e.target.checked);
                      }}
                    >
                      {opt.label}
                    </Checkbox>
                  );
                })}
              </Panel>
            );
          })}
        </Collapse>
      </Form>)
  }

  return (
    <>
      {contextHolder}
      {message && openToast("bottom")}
      <Modal
        destroyOnClose={true}
        open={isCreateModalOpen}
        title={primaryAction.content}
        onOk={modalView ? primaryAction.onToggle : primaryAction.onConfirm}
        okType={"primary"}
        okText={modalView ? "Continue" : "Next"}
        okButtonProps={{ disabled: primaryAction.disabled }}
        onCancel={() => {
          toggleCreateModal(false);
          setModalView(true);
        }}
        confirmLoading={primaryAction.loading}
        width={672}
      >
        <Divider />
        {modalView ? formStepFirst() : formStepSec()}
      </Modal>
      <PropertyCreateConfirmModal
        isCreateConfirmModalOpen={isCreateConfirmModalOpen}
        toggleCreateConfirmModal={toggleCreateConfirmModal}
        handleSubmitCreateProperty={handleSubmitCreateProperty}
        isCreatePropertySubmitting={isCreatePropertySubmitting}
      />
    </>
  );
}

export default PropertyCreateModal;
