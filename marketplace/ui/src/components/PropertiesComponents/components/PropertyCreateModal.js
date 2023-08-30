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
  Upload,
} from "antd";

import {
  ArrowLeftOutlined,
  PlusOutlined,
} from "@ant-design/icons";

import {
  categoriesObj,
  stateData,
  homeTypeData,
  propertyConstants,
  createPropertyFormInitialData,
} from "../helpers/constants";
import PropertyCreateConfirmModal from "./PropertyCreateConfirmModal";
import { actions } from "../../../contexts/propertyContext/actions";
import {
  usePropertiesDispatch,
  usePropertiesState,
} from "../../../contexts/propertyContext";
import { useParams } from "react-router-dom";
const { LIMIT_PER_PAGE } = propertyConstants;
const { Panel } = Collapse;
const { Option } = Select;
const { Text } = Typography;

const getBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });

function PropertyCreateModal({
  isCreateModalOpen,
  toggleCreateModal,
  formData,
}) {

  let { id } = useParams();

  const [modalView, setModalView] = useState(true);
  const [isCreateConfirmModalOpen, toggleCreateConfirmModal] = useState(false);

  const [disableLotSize, setDisableLotSize] = useState(false);

  const [api, contextHolder] = notification.useNotification();
  const dispatch = usePropertiesDispatch();

  const { message, success, isCreatePropertySubmitting, isUpdatePropertySubmitting } = usePropertiesState();
  const [propertyData, setPropertyData] = useState(formData);
  //TODO:- Can uncomment when use image upload ***
  const [selectedImage, setSelectedImage] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState("");
  const [previewTitle, setPreviewTitle] = useState("");
  const [fileList, setFileList] = useState([]);

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

    const body = propertyData

    if (id) {
      let {
        chainId,
        block_hash,
        block_number,
        block_timestamp,
        address,
        record_id,
        transaction_hash,
        transaction_sender,
        standardStatus,
        unparsedAddress,
        latitude,
        longitude,
        reviews,
        organization,
        ...updatedData
      } = body;
      updatedData["propertyAddress"] = address;


      let response = await actions.updateProperty(dispatch, updatedData);
      if (response) {
        toggleCreateModal(false)
        toggleCreateConfirmModal(false)
        setModalView(true);

      }
    } else {

        const formData = new FormData()
        for (const key in body) {
          formData.append(key, body[key])
        }
        fileList.forEach((file) => {
          formData.append('images', file.originFileObj);
        }); 

      let response = await actions.createProperty(dispatch, formData);
      if (response) {
        toggleCreateModal(false)
        toggleCreateConfirmModal(false)
        setModalView(true);
        actions.fetchProperties(dispatch, LIMIT_PER_PAGE, 0)
        setPropertyData(createPropertyFormInitialData)
            Modal.destroyAll();
      }
    }
  };

  const handleCancel = () => setPreviewOpen(false);
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
  const handleFileChange = ({ fileList: newFileList }) => {
    setFileList(newFileList);
  }

  const primaryAction = {
    content: modalView ? (
      id ?"Update Property":"Create a Property Listing"
    ) : (
      <>
        <Button type="link" onClick={handleModalToggle}>
          <ArrowLeftOutlined />
        </Button>
        <Text>Property Listing - House Facts</Text>
      </>
    ),
    // disabled: modalView ? isDisabledCreateView : isDisabledFactsView,
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
            value={title}
            defaultValue={title}
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
            defaultValue={description}
            maxLength={500}
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
                defaultValue={numberOfUnitsTotal}
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
                defaultValue={listPrice}
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
            defaultValue={streetName}
            disabled={id}
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
                disabled={id}
                controls={false}
                value={streetNumber}
                defaultValue={streetNumber}
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
                disabled={id}
                controls={false}
                value={unitNumber}
                defaultValue={unitNumber}
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
            defaultValue={stateOrProvince}
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
                disabled={id}
                value={postalCity}
                defaultValue={postalCity}
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
                disabled={id}
                controls={false}
                value={postalcode}
                defaultValue={postalcode}
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

        <Form.Item>
        <Upload
        listType="picture-card"
        fileList={fileList}
        onPreview={handlePreview}
        onChange={handleFileChange}
        accept="image/*"
      >
        {fileList.length >= 8 ? null : 
            <div>
            <PlusOutlined />
            <div
              style={{
                marginTop: 8,
              }}
            >
              Upload
            </div>
          </div>}
      </Upload>
      <Modal open={previewOpen} title={previewTitle} footer={null} onCancel={handleCancel}>
        <img
          alt="example"
          style={{
            width: '100%',
          }}
          src={previewImage}
        />
      </Modal>
        </Form.Item>
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
            defaultValue={propertyType}
            disabled={id}
            onSelect={(value) => {
              handleChange("propertyType", value);
              if((value === "apartment" || value === "condo")) {
                setDisableLotSize(true)
                handleChange("lotSizeArea", 0);
              } else {
                setDisableLotSize(false)
              }
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
                defaultValue={bedroomsTotal}
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
                defaultValue={bathroomsTotalInteger}
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
                defaultValue={livingArea}
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
                defaultValue={lotSizeArea}
                onChange={(value) => {
                  handleChange("lotSizeArea", value);
                }}
                onWheel={(e) => {
                  e.target.blur();
                }}
                disabled={disableLotSize}
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
                      checked={propertyData[opt.value]}
                      defaultChecked={propertyData[opt.value]}
                      onChange={(e) => {
                        handleChange(opt.value, e.target.checked);
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
        okText={modalView ? "Continue" : id ? "Update Property" : "Create Property"}
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
        isCreatePropertySubmitting={isCreatePropertySubmitting || isUpdatePropertySubmitting}
        isEdit={id}
      />
    </>
  );
}

export default PropertyCreateModal;