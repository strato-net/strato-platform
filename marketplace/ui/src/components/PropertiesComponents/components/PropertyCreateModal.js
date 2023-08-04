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
} from "antd";
import { PlusOutlined, ArrowLeftOutlined } from "@ant-design/icons";
import { StateData, HomeTypeData } from "../helpers/constants";
import { getStringDate } from "../helpers/utils";
import PropertyCreateConfirmModal from "./PropertyCreateConfirmModal";
import { actions } from "../../../contexts/propertyContext/actions";
import { usePropertiesDispatch } from "../../../contexts/propertyContext";

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

  const [propertyData, setPropertyData] = useState({});
  const [homeType, setHomeType] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  const [bathrooms, setBathrooms] = useState("");
  const [squareFeet, setSquareFeet] = useState("");
  // const [yearBuilt, setYearBuilt] = useState("");
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
    // !yearBuilt ||
    !lotSize;

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

  return (
    <>
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
                onChange={(e) => {
                  handleChange("projectDescription", e.target.value);
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
                precision={0}
                label="Lot Number"
                type="Number"
                min={0}
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
                label="Zip Code"
                type="Number"
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

            <Form.Item
              label="Images"
              name="images"
              rules={[
                { message: "Please property upload images if avaliable." },
              ]}
            >
              <Upload
                action="https://www.mocky.io/v2/5cc8019d300000980a055e76"
                listType="picture-card"
                fileList={fileList}
                onPreview={handlePreview}
                onChange={handleFileChange}
              >
                {uploadButton}
              </Upload>
              <Modal
                open={previewOpen}
                title={previewTitle}
                footer={null}
                onCancel={handleCancel}
              >
                <img
                  alt="example"
                  style={{ width: "100%" }}
                  src={previewImage}
                />
              </Modal>
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
              {/* <Form.Item
                label="Year Built"
                name="yearBuilt"
                rules={[
                  { required: true, message: "Please input an asking price." },
                ]}
              >
                <DatePicker picker="year" onChange={(e) => setYearBuilt(e)} />
              </Form.Item> */}
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
                label="Appliances"
                name="appliances"
                rules={[{ message: "Please input an asking price." }]}
              ></Form.Item>
              <Form.Item
                label="Flooring"
                name="flooring"
                rules={[{ message: "Please input an asking price." }]}
              ></Form.Item>
              <Form.Item
                label="Cooling"
                name="cooling"
                rules={[{ message: "Please input an asking price." }]}
              ></Form.Item>
              <Form.Item
                label="Heating"
                name="heating"
                rules={[{ message: "Please input an asking price." }]}
              ></Form.Item>
              <Form.Item
                label="Parking"
                name="parking"
                rules={[{ message: "Please input an asking price." }]}
              ></Form.Item>
              <Form.Item
                label="Interior Features"
                name="interiorFeatures"
                rules={[{ message: "Please input an asking price." }]}
              ></Form.Item>
              <Form.Item
                label="Exterior Features"
                name="exteriorFeatures"
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
