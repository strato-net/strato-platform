import React, { useState } from "react";
import {
  Modal,
  Form,
  Divider,
  Input,
  InputNumber,
  Upload,
  Button,
  Select,
  notification,
  Typography,
  Checkbox,
  Collapse,
  Row,
  Col
} from "antd";
import { PlusOutlined, ArrowLeftOutlined, PictureOutlined } from "@ant-design/icons";
import {
  StateData,
  HomeTypeData,
  parkingFeaturesData,
  heatingData,
  coolingData,
  flooringData,
  appliancesData,
  interiorFeaturesData,
  exteriorFeaturesData
} from "../helpers/constants";
import { getStringDate } from "../helpers/utils";
import PropertyCreateConfirmModal from "./PropertyCreateConfirmModal";
import { actions } from "../../../contexts/propertyContext/actions";
import { usePropertiesDispatch, usePropertiesState } from "../../../contexts/propertyContext";
const { Panel } = Collapse;
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
  modalView,
  setModalView,
  isCreateConfirmModalOpen,
  toggleCreateConfirmModal,
}) {
  const dispatch = usePropertiesDispatch();
  const [api, contextHolder] = notification.useNotification();
  const { message, success } = usePropertiesState()

  const [selectedImage, setSelectedImage] = useState(null);
  const [propertyData, setPropertyData] = useState({});
  const [homeType, setHomeType] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [squareFeet, setSquareFeet] = useState("");
  const [lotSize, setLotSize] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState("");
  const [previewTitle, setPreviewTitle] = useState("");
  const [fileList, setFileList] = useState([]);

  const {
    title,
    description,
    propertyType,
    listPrice,
    streetName,
    streetNumber,
    lotNumber,
    postalCity,
    stateOrProvince,
    postalcode,
    askingPrice,
    bedroomsTotal,
    bathroomsTotalInteger,
    livingArea,
    lotSizeAreaUnits,
    appliances,
    heating,
    cooling,
    flooring,
    parking,
    interior,
    exterior,
    lotSizeArea
  } = propertyData;
  
  const isDisabledCreateView =
    !title ||
    !description ||
    !lotNumber ||
    !streetName ||
    !streetNumber ||
    !postalCity ||
    !stateOrProvince ||
    !postalcode ||
    !askingPrice;

  const isDisabledFactsView =
    !propertyType ||
    !bedroomsTotal ||
    !bathroomsTotalInteger ||
    !livingArea ||
    // !yearBuilt ||
    !lotSizeAreaUnits;

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

  function beforeUpload(file) {
    const isJpgOrPng = file.type === 'image/jpeg' || file.type === 'image/png';
    if (!isJpgOrPng) {
      openToast("bottom", "Image must be of jpeg or png format");
    }
    const isLt1M = file.size / 1024 / 1024 < 1;
    if (!isLt1M) {
      openToast("bottom", "Cannot upload an image of size more than 1mb");
    }
    return isJpgOrPng && isLt1M;
  }

  //creates the listing for property
  const handleSubmitCreateProperty = async () => {

    const body = {
      title: title,
      description: description,
      propertyType: propertyType,
      listPrice: listPrice,
      // unparsedAddress: '${body.streetNumber} ${body.streetName} ${body.unitNumber}, ${body.postalCity}, ${body.stateOrProvince} ${body.postalCode}',
      streetName: streetName,
      streetNumber: streetNumber,
      unitNumber: 'body.unitNumber',
      postalCity: postalCity,
      stateOrProvince: stateOrProvince,
      postalcode: postalcode,
      bathroomsTotalInteger: bathroomsTotalInteger,
      bedroomsTotal: bedroomsTotal,
      lotSizeArea: lotSizeArea,
      lotSizeUnits: 'sqft',
      livingArea: 100,
      livingAreaUnits: 'sqft',
      numberOfUnitsTotal: 3,

      // Appliances
      dishwasher: appliances.includes("dishwasher"),
      dryer: appliances.includes("dryer"),
      freezer: appliances.includes("freezer"),
      garbageDisposal: appliances.includes("garbageDisposal"),
      microwave: appliances.includes("microwave"),
      ovenOrRange: appliances.includes("ovenOrRange"),
      refrigerator: appliances.includes("refrigerator"),
      washer: appliances.includes("washer"),
      waterHeater: appliances.includes("waterHeater"),

      // Cooling
      centralAir: cooling.includes("centralAir"),
      evaporative: cooling.includes("evaporative"),
      geoThermal: cooling.includes("geoThermal"),
      refrigeration: cooling.includes("refrigeration"),
      solar: cooling.includes("solar"),
      wallUnit: cooling.includes("wallUnit"),

      // Heating
      baseboard: heating.includes("baseboard"),
      forceAir: heating.includes("forceAir"),
      geoThermalHeat: heating.includes("geoThermalHeat"),
      heatPump: heating.includes("heatPump"),
      hotWater: heating.includes("hotWater"),
      radiant: heating.includes("radiant"),
      solarHeat: heating.includes("solarHeat"),
      steam: heating.includes("steam"),

      // Flooring
      carpet: flooring.includes("carpet"),
      concrete: flooring.includes("concrete"),
      hardwood: flooring.includes("hardwood"),
      laminate: flooring.includes("laminate"),
      linoleumVinyl: flooring.includes("linoleumVinyl"),
      slate: flooring.includes("slate"),
      softwood: flooring.includes("softwood"),
      tile: flooring.includes("tile"),

      // Parking
      carport: parking.includes("carport"),
      garage: parking.includes("garage"),
      offStreet: parking.includes("offStreet"),
      onStreet: parking.includes("onStreet"),

      // Interior Features
      attic: interior.includes("attic"),
      cableReady: interior.includes("cableReady"),
      ceilingFan: interior.includes("ceilingFan"),
      doublePaneWindows: interior.includes("doublePaneWindows"),
      elevator: interior.includes("elevator"),
      fireplace: interior.includes("fireplace"),
      flooring: interior.includes("flooring"),
      furnished: interior.includes("furnished"),
      jettedTub: interior.includes("jettedTub"),
      securitySystem: interior.includes("securitySystem"),
      vaultedCeiling: interior.includes("vaultedCeiling"),
      skylight: interior.includes("skylight"),
      wetBar: interior.includes("wetBar"),

      // Exterior Features
      barbecueArea: exterior.includes("barbecueArea"),
      deck: exterior.includes("deck"),
      dock: exterior.includes("dock"),
      fence: exterior.includes("fence"),
      garden: exterior.includes("garden"),
      hotTubOrSpa: exterior.includes("hotTubOrSpa"),
      lawn: exterior.includes("lawn"),
      patio: exterior.includes("patio"),
      pond: exterior.includes("pond"),
      pool: exterior.includes("pool"),
      porch: exterior.includes("porch"),
      rvParking: exterior.includes("rvParking"),
      sauna: exterior.includes("sauna"),
      sprinklerSystem: exterior.includes("sprinklerSystem"),
      waterFront: exterior.includes("waterFront"),
    };
    let [isDone, projectAddress] = await actions.createProperty(dispatch, body);

    // if (isDone) {

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

    //   setTimeout(() => navigate(`/projects/${projectAddress}`), 2000)

    //   // setTimeout(() => navigate(`/projects`),2000)

    //   actions.mintProjectCredits(dispatch, { projectAddress: projectAddress })

    //   // await actions.fetchProject(dispatch, 10, 0, debouncedSearchTerm);
    // }
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

  const handleFileChange = ({ fileList: newFileList }) =>
    setFileList(newFileList);

  const uploadButton = (
    <div>
      <PlusOutlined />
      <div style={{ marginTop: 8 }}>Upload</div>
    </div>
  );

  const primaryAction = {
    content: modalView
      ? "Create a Property Listing"
      : <>
        <Button type="link" onClick={handleModalToggle}>
          <ArrowLeftOutlined />
        </Button>
        <Text>Property Listing - House Facts</Text>
      </>,
    disabled: modalView ? isDisabledCreateView : isDisabledFactsView,
    onToggle: handleModalToggle,
    onConfirm: showConfirmationModal,
  };
  const layout = {
    labelCol: { span: 8 },
    wrapperCol: { span: 16 },
  };

  const openToast = (placement) => {

    if (success) {
      api.success({
        message: "message-success",
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: "message-failed",
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 2,
      });
    }
  };

  return (
    <>
      {contextHolder}
      <Modal
        {...layout}
        open={isCreateModalOpen}
        title={primaryAction.content}
        onOk={modalView ? primaryAction.onToggle : primaryAction.onConfirm}
        okType={"primary"}
        okText={modalView ? "Continue" : "Next"}
        // uncomment later******
        // okButtonProps={{ disabled: primaryAction.disabled }}
        onCancel={() => {
          toggleCreateModal(false);
          setModalView(true);
        }}
        // confirmLoading={primaryAction.loading}
        width={850}
      >
        <Divider />
        {modalView ? (
          <Form labelCol={{ span: 8 }} labelAlign="left">
            <Form.Item
              label="Listing Title"
              name="title"
              rules={[
                { required: true, message: "Please input project name." },
              ]}
            >
              <Input
                label="title"
                defaultValue={title}
                value={title}
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
                  message: "Please input project description.",
                },
              ]}
            >
              <Input.TextArea
                label="Project Description"
                defaultValue={description}
                value={description}
                maxLength={500}
                showCount
                placeholder="Project Description"
                onChange={(e) => {
                  handleChange("description", e.target.value);
                }}
              />
            </Form.Item>
            <Form.Item
              label="Asking Price"
              name="listPrice"
              rules={[
                { required: true, message: "Please input an asking price." },
              ]}
            >
              <InputNumber
                precision={0}
                label="Asking Price"
                type="Number"
                min={0}
                placeholder="Asking Price"
                controls={false}
                addonBefore="$"
                defaultValue={listPrice}
                value={listPrice}
                onChange={(e) => {
                  handleChange("listPrice", e);
                }}
                onWheel={(e) => {
                  e.target.blur();
                }}
              />
            </Form.Item>
            <Form.Item
              label="Lot Number"
              name="lotNumber"
              rules={[
                { required: true, message: "Please input an asking price." },
              ]}
            >
              <InputNumber
                style={{ width: 150 }}
                precision={0}
                label="Lot Number"
                type="Number"
                min={0}
                placeholder="Lot Number"
                controls={false}
                defaultValue={propertyData?.lotNumber}
                value={propertyData?.lotNumber}
                onChange={(e) => {
                  handleChange("lotSizeAreaUnits", e);
                }}
                onWheel={(e) => {
                  e.target.blur();
                }}
              />
            </Form.Item>
            <Form.Item
              label="Street Name"
              name="streetName"
              rules={[
                { required: true, message: "Please input an asking price." },
              ]}
            >
              <Input
                label="Street Name"
                id="streetname"
                placeholder="Street Name"
                defaultValue={streetName}
                value={streetName}
                onChange={(e) => {
                  handleChange("streetName", e.target.value);
                }}
              />
            </Form.Item>
            <Form.Item
              label="Street Number"
              name="streetNumber"
              rules={[
                { required: true, message: "Please input an asking price." },
              ]}
            >
              <InputNumber
                label="Street Number"
                id="streetnumber"
                placeholder="Street Number"
                controls={false}
                defaultValue={streetNumber}
                value={streetNumber}
                onChange={(value) => {
                  handleChange("streetNumber", value);
                }}
                onWheel={(e) => {
                  e.target.blur();
                }}
              />
            </Form.Item>
            <Form.Item
              label="City"
              name="city"
              rules={[
                { required: true, message: "Please input an asking price." },
              ]}
            >
              <Input
                label="City"
                id="city"
                placeholder="City"
                defaultValue={postalCity}
                value={postalCity}
                onChange={(e) => {
                  handleChange("postalCity", e.target.value);
                }}
              />
            </Form.Item>
            <Form.Item
              label="State"
              name="state"
              rules={[
                { required: true, message: "Please input an asking price." },
              ]}
            >
              <Select
                label="State"
                defaultValue={stateOrProvince}
                value={stateOrProvince}
                placeholder="Select State"
                onSelect={(e) => {
                  handleChange("stateOrProvince", e);
                }}
                options={StateData}
                showSearch
              />
            </Form.Item>
            <Form.Item
              label="Zip Code"
              name="postalCode"
              rules={[{ required: true, message: "Please input a zip code." }]}
            >
              <InputNumber
                precision={0}
                style={{ width: 150 }}
                label="Zip Code"
                type="Number"
                placeholder="ZipCode"
                min={0}
                max={99999}
                controls={false}
                defaultValue={postalcode}
                value={postalcode}
                onChange={(value) => {
                  handleChange("postalcode", value);
                }}
                onWheel={(e) => {
                  e.target.blur();
                }}
              />
            </Form.Item>

            <Form.Item label="Upload Image" name="image">
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
            </Form.Item>
          </Form>
        ) : (
          <div>
            <Form labelCol={{ span: 8 }} labelAlign="left">
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
                  defaultValue={homeType}
                  onSelect={(value) => { handleChange("propertyType", value) }}
                  options={HomeTypeData}
                  showSearch
                />
              </Form.Item>
              <Form.Item
                label="Bedrooms"
                name="bedrooms"
                rules={[
                  { required: true, message: "Please Enter Number of Bedrooms." },
                ]}
              >
                <InputNumber
                  precision={0}
                  label="bedrooms"
                  placeholder="Bedrooms"
                  type="Number"
                  controls={false}
                  min={0}
                  value={bedrooms}
                  defaultValue={bedrooms}
                  onChange={(value) => { handleChange("bedroomsTotal", value) }}
                  onWheel={(e) => {
                    e.target.blur();
                  }}
                />
              </Form.Item>
              <Form.Item
                label="Bathrooms"
                name="bathrooms"
                rules={[
                  { required: true, message: "Please Enter Number of Bathrooms" },
                ]}
              >
                <InputNumber
                  precision={0}
                  label="bathrooms"
                  placeholder="Bathrooms"
                  type="Number"
                  controls={false}
                  min={0}
                  defaultValue={bathrooms}
                  onChange={(value) => { handleChange("bathroomsTotalInteger", value) }}
                  onWheel={(e) => {
                    e.target.blur();
                  }}
                />
              </Form.Item>
              <Form.Item
                label="Square Ft"
                name="squareFeet"
                rules={[
                  { required: true, message: "Please Enter Square Feet" },
                ]}
              >
                <InputNumber
                  precision={0}
                  label="squareFeet"
                  placeholder="Square Feet"
                  type="Number"
                  controls={false}
                  min={0}
                  defaultValue={squareFeet}
                  onChange={(value) => { handleChange("livingArea", value) }}
                  onWheel={(e) => {
                    e.target.blur();
                  }}
                />
              </Form.Item>
              <Form.Item
                label="Lot Size Area"
                name="lotSize"
                rules={[
                  { required: true, message: "Please input an asking price." },
                ]}
              >
                <InputNumber
                  precision={0}
                  label="lotSize"
                  placeholder="Lot Size"
                  type="Number"
                  controls={false}
                  min={0}
                  defaultValue={lotSizeArea}
                  onChange={(value) => { handleChange("lotSizeArea", value) }}
                  onWheel={(e) => {
                    e.target.blur();
                  }}
                />
              </Form.Item>
              <Collapse
                expandIconPosition={"end"}
                defaultActiveKey={[]}
              >
                <Panel style={{ fontWeight: 700 }} header="Appliances" key="1">
                  <Row>
                    <Col>
                      <Checkbox.Group
                        style={{ display: "block", lineHeight: "30px" }}
                        options={appliancesData}
                        value={appliances}
                        onChange={(value) => {
                          handleChange("appliances", value);
                        }}
                      />
                    </Col>
                  </Row>
                </Panel>

                <Panel style={{ fontWeight: 700 }} header="Cooling" key="2">
                  <Checkbox.Group
                    style={{ display: "block", lineHeight: "30px" }}
                    options={coolingData}
                    value={cooling}
                    onChange={(value) => {
                      handleChange("cooling", value);
                    }}
                  />
                </Panel>

                <Panel style={{ fontWeight: 700 }} header="Heating" key="3">
                  <Checkbox.Group
                    style={{ display: "block", lineHeight: "30px" }}
                    options={heatingData}
                    value={heating}
                    onChange={(value) => {
                      handleChange("heating", value);
                    }}
                  />
                </Panel>

                <Panel style={{ fontWeight: 700 }} header="Flooring" key="4">
                  <Checkbox.Group
                    style={{ display: "block", lineHeight: "30px" }}
                    options={flooringData}
                    value={flooring}
                    onChange={(value) => {
                      handleChange("flooring", value);
                    }}
                  />
                </Panel>

                <Panel style={{ fontWeight: 700 }} header="Parking" key="5">
                  <Checkbox.Group
                    style={{ display: "block", lineHeight: "30px" }}
                    options={parkingFeaturesData}
                    value={parking}
                    onChange={(value) => {
                      handleChange("parking", value);
                    }}
                  />
                </Panel>

                <Panel style={{ fontWeight: 700 }} header="Interior Features" key="6">
                  <Checkbox.Group
                    style={{ display: "block", lineHeight: "30px" }}
                    options={interiorFeaturesData}
                    value={interior}
                    onChange={(value) => {
                      handleChange("interior", value);
                    }}
                  />
                </Panel>

                <Panel style={{ fontWeight: 700 }} header="Exterior Features" key="7">
                  <Checkbox.Group
                    style={{ display: "block", lineHeight: "30px" }}
                    options={exteriorFeaturesData}
                    value={exterior}
                    onChange={(value) => {
                      handleChange("exterior", value);
                    }}
                  />
                </Panel>
              </Collapse>
            </Form>
          </div>
        )}
      </Modal>
      <PropertyCreateConfirmModal
        isCreateConfirmModalOpen={isCreateConfirmModalOpen}
        toggleCreateConfirmModal={toggleCreateConfirmModal}
        handleSubmitCreateProperty={handleSubmitCreateProperty}
      />
    </>
  );
}

export default PropertyCreateModal;
