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
  Collapse,
  DatePicker,
  notification
} from "antd";
import { PlusOutlined, ArrowLeftOutlined, PictureOutlined } from "@ant-design/icons";
import { StateData, HomeTypeData } from "../helpers/constants";
import { getStringDate } from "../helpers/utils";
import PropertyCreateConfirmModal from "./PropertyCreateConfirmModal";
import { actions } from "../../../contexts/propertyContext/actions";
import { usePropertiesDispatch, usePropertiesState } from "../../../contexts/propertyContext";

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
  const [yearBuilt, setYearBuilt] = useState("");
  const [lotSize, setLotSize] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState("");
  const [previewTitle, setPreviewTitle] = useState("");
  const [fileList, setFileList] = useState([]);

  const {
    name,
    description,
    lotNumber,
    addressLine1,
    addressLine2,
    city,
    state,
    zipCode,
    askingPrice,
  } = propertyData;

  const isDisabledCreateView =
    !name ||
    !description ||
    !lotNumber ||
    !addressLine1 ||
    !addressLine2 ||
    !city ||
    !state ||
    !zipCode ||
    !askingPrice;

  const isDisabledFactsView =
    !homeType ||
    !bedrooms ||
    !bathrooms ||
    !squareFeet ||
    !yearBuilt ||
    !lotSize;

  const handleModalToggle = () => {
    if (isDisabledCreateView) {
    } else {
      setModalView(!modalView);
    }
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
  const handleSubmitCreateProperty = () => {
    const body = {};
    // let [isDone, projectAddress] = await actions.createProject(dispatch, body);

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
      : "Property Listing - House Facts",
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
              name="name"
              rules={[
                { required: true, message: "Please input project name." },
              ]}
            >
              <Input
                label="name"
                defaultValue={propertyData?.name}
                value={propertyData?.name}
                maxLength={100}
                placeholder="Listing Title"
                showCount
                onChange={(e) => {
                  handleChange("name", e.target.value);
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
                defaultValue={propertyData?.projectDescription}
                value={propertyData?.projectDescription}
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
              name="askingPrice"
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
                defaultValue={propertyData?.askingPrice}
                value={propertyData?.askingPrice}
                onChange={(e) => {
                  handleChange("askingPrice", e);
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
                  handleChange("lotNumber", e);
                }}
                onWheel={(e) => {
                  e.target.blur();
                }}
              />
            </Form.Item>
            <Form.Item
              label="Address Line 1"
              name="addressLine1"
              rules={[
                { required: true, message: "Please input an asking price." },
              ]}
            >
              <Input
                label="Address Line 1"
                id="addressLine1"
                placeholder="Address Line 1"
                defaultValue={propertyData?.addressLine1}
                value={propertyData?.addressLine1}
                onChange={(e) => {
                  handleChange("addressLine1", e.target.value);
                }}
              />
            </Form.Item>
            <Form.Item
              label="Address Line 2"
              name="addressLine2"
              rules={[
                { required: true, message: "Please input an asking price." },
              ]}
            >
              <Input
                label="Address Line 2"
                id="addressLine2"
                placeholder="Address Line 2"
                defaultValue={propertyData?.addressLine2}
                value={propertyData?.addressLine2}
                onChange={(e) => {
                  handleChange("addressLine2", e.target.value);
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
                defaultValue={propertyData?.city}
                value={propertyData?.city}
                onChange={(e) => {
                  handleChange("city", e.target.value);
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
                defaultValue={propertyData?.state}
                value={propertyData?.state}
                placeholder="Select State"
                onSelect={(e) => {
                  handleChange("state", e);
                }}
                options={StateData}
                showSearch
              />
            </Form.Item>
            <Form.Item
              label="Zip Code"
              name="zipCode"
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
                defaultValue={propertyData?.zipCode}
                value={propertyData?.zipCode}
                onChange={(value) => {
                  handleChange("zipCode", value);
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
            <Button type="link" onClick={handleModalToggle}>
              <ArrowLeftOutlined />
            </Button>
            <Form labelCol={{ span: 8 }} labelAlign="left">
              <Form.Item
                label="Home Type"
                name="homeType"
                rules={[
                  { required: true, message: "Please input an asking price." },
                ]}
              >
                <Select
                  label="homeType"
                  defaultValue={homeType}
                  onSelect={(e) => setHomeType(e)}
                  options={HomeTypeData}
                  showSearch
                />
              </Form.Item>
              <Form.Item
                label="Bedrooms"
                name="bedrooms"
                rules={[
                  { required: true, message: "Please input an asking price." },
                ]}
              >
                <InputNumber
                  precision={0}
                  label="bedrooms"
                  type="Number"
                  controls={false}
                  min={0}
                  value={bedrooms}
                  defaultValue={bedrooms}
                  onChange={(e) => setBedrooms(e)}
                  onWheel={(e) => {
                    e.target.blur();
                  }}
                />
              </Form.Item>
              <Form.Item
                label="Bathrooms"
                name="bathrooms"
                rules={[
                  { required: true, message: "Please input an asking price." },
                ]}
              >
                <InputNumber
                  precision={0}
                  label="bathrooms"
                  type="Number"
                  controls={false}
                  min={0}
                  defaultValue={bathrooms}
                  onChange={(e) => setBathrooms(e)}
                  onWheel={(e) => {
                    e.target.blur();
                  }}
                />
              </Form.Item>
              <Form.Item
                label="Square Ft"
                name="squareFeet"
                rules={[
                  { required: true, message: "Please input an asking price." },
                ]}
              >
                <InputNumber
                  precision={0}
                  label="squareFeet"
                  type="Number"
                  controls={false}
                  min={0}
                  defaultValue={squareFeet}
                  onChange={(e) => setSquareFeet(e)}
                  onWheel={(e) => {
                    e.target.blur();
                  }}
                />
              </Form.Item>
              <Form.Item
                label="Year Built"
                name="yearBuilt"
                rules={[
                  { required: true, message: "Please input an asking price." },
                ]}
              >
                <DatePicker picker="year" onChange={(e) => setYearBuilt(e)} />
              </Form.Item>
              <Form.Item
                label="Lot Size"
                name="lotSize"
                rules={[
                  { required: true, message: "Please input an asking price." },
                ]}
              >
                <InputNumber
                  precision={0}
                  label="lotSize"
                  type="Number"
                  controls={false}
                  min={0}
                  defaultValue={lotSize}
                  onChange={(e) => setLotSize(e)}
                  onWheel={(e) => {
                    e.target.blur();
                  }}
                />
              </Form.Item>
              <Form.Item
                label="Room Details"
                name="lotSize"
                rules={[{ message: "Please input an asking price." }]}
              >
                <Collapse></Collapse>
              </Form.Item>

              <Form.Item
                label="Building Details"
                name="lotSize"
                rules={[{ message: "Please input an asking price." }]}
              ></Form.Item>

              <Form.Item
                label="Utilities*"
                name="lotSize"
                rules={[{ message: "Please input an asking price." }]}
              ></Form.Item>
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
