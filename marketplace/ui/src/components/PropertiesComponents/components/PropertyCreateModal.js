import React, { useState } from 'react'
import { Modal, Form, Divider, Input, InputNumber, Upload, Button, Select } from 'antd'
import { PlusOutlined, ArrowLeftOutlined } from '@ant-design/icons';
import { StateData } from '../helpers/constants'
import PropertyCreateConfirmModal from './PropertyCreateConfirmModal';

const getBase64 = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result);
    reader.onerror = (error) => reject(error);
  });

function PropertyCreateModal({ isCreateModalOpen, toggleCreateModal, modalView, setModalView, isCreateConfirmModalOpen, toggleCreateConfirmModal }) {
  const [name, setname] = useState('')
  const [description, setdescription] = useState('')
  const [lotNumber, setLotNumber] = useState('')
  const [addressLine1, setAddressLine1] = useState('')
  const [addressLine2, setAddressLine2] = useState('')
  const [city, setCity] = useState('')
  const [state, setState] = useState('')
  const [zipCode, setZipCode] = useState('')
  const [askingPrice, setaskingPrice] = useState('')

  const [homeType, setHomeType] = useState('')
  const [bedrooms, setBedrooms] = useState('')
  const [bathrooms, setBathrooms] = useState('')
  const [squareFeet, setSquareFeet] = useState('')
  const [yearBuilt, setYearBuilt] = useState('')
  const [lotSize, setLotSize] = useState('')

  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewImage, setPreviewImage] = useState('');
  const [previewTitle, setPreviewTitle] = useState('');
  const [fileList, setFileList] = useState([]);

  const isDisabledCreateView = (!name || !description || !lotNumber || !addressLine1 || !addressLine2 || !city || !state || !description || !zipCode || !askingPrice);
  const isDisabledFactsView = (!homeType || !bedrooms || !bathrooms || !squareFeet || !yearBuilt || !lotSize);

  const handleModalToggle = () => {
    setModalView(!modalView)
  }

  const showConfirmationModal = () => {
    toggleCreateConfirmModal(!isCreateConfirmModalOpen)
  }

  //creates the listing for property
  const handleSubmitCreateProperty = () => {
    const body = {

    }
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

  }

  const handleCancel = () => setPreviewOpen(false);

  const handlePreview = async (file) => {
    if (!file.url && !file.preview) {
      file.preview = await getBase64(file.originFileObj);
    }
    setPreviewImage(file.url || file.preview);
    setPreviewOpen(true);
    setPreviewTitle(file.name || file.url.substring(file.url.lastIndexOf('/') + 1));
  };

  const handleChange = ({ fileList: newFileList }) => setFileList(newFileList);

  const uploadButton = (
    <div>
      <PlusOutlined />
      <div style={{ marginTop: 8 }}>Upload</div>
    </div>
  );

  const primaryAction = {
    content: modalView ? "Create a Property Listing" : "Property Listing - House Facts",
    disabled: modalView ? isDisabledCreateView : isDisabledFactsView,
    onToggle: handleModalToggle,
    onConfirm: showConfirmationModal,
  };

  return (
    <>
      <Modal
        open={isCreateModalOpen}
        title={primaryAction.content}
        onOk={modalView ? primaryAction.onToggle : primaryAction.onConfirm}
        okType={"primary"}
        okText={modalView ? "Continue" : "Next"}
        // uncomment later******
        // okButtonProps={{ disabled: primaryAction.disabled }}
        onCancel={() => {
          toggleCreateModal(false)
          setModalView(true)
        }}
        // confirmLoading={primaryAction.loading}
        width={850}
      >
        <Divider />
        {modalView ? (
          <Form labelCol={{ span: 8 }} labelAlign='left'>
            <Form.Item
              label="Listing Title*"
              name="name"
              rules={[{ message: 'Please input project name.' }]}
            >
              <Input
                label="name"
                defaultValue={name}
                maxLength={100}
                showCount
                onChange={(e) => setname(e.target.value)}
              />
            </Form.Item>
            <Form.Item
              label="Project Description*"
              name="description"
              rules={[{ message: 'Please input project description.' }]}
            >
              <Input.TextArea
                label="Project Description"
                defaultValue={description}
                maxLength={500}
                showCount
                onChange={(e) => setdescription(e.target.value)}
              />
            </Form.Item>
            <Form.Item
              label="Asking Price*"
              name="askingPrice"
              rules={[{ message: 'Please input an asking price.' }]}
            >
              <InputNumber
                precision={0}
                label="Asking Price"
                min={0}
                addonBefore="$"
                defaultValue={askingPrice}
                onChange={(e) => setaskingPrice(e)}
              />
            </Form.Item>
            <Form.Item
              label="Lot Number*"
              name="lotNumber"
              rules={[{ message: 'Please input an asking price.' }]}
            >
              <InputNumber
                precision={0}
                label="Lot Number"
                min={0}
                defaultValue={lotNumber}
                onChange={(e) => setLotNumber(e)}
              />
            </Form.Item>
            <Form.Item
              label="Address Line 1*"
              name="street"
              rules={[{ message: 'Please input an asking price.' }]}
            >
              <Input
                label="Street"
                defaultValue={addressLine1}
                onChange={(e) => setAddressLine1(e.target.value)}
              />
            </Form.Item>
            <Form.Item
              label="Address Line 2*"
              name="street"
              rules={[{ message: 'Please input an asking price.' }]}
            >
              <Input
                label="Street"
                defaultValue={addressLine2}
                onChange={(e) => setAddressLine2(e.target.value)}
              />
            </Form.Item>
            <Form.Item
              label="City*"
              name="city"
              rules={[{ message: 'Please input an asking price.' }]}
            >
              <Input
                label="City"
                defaultValue={city}
                onChange={(e) => setCity(e.target.value)}
              />
            </Form.Item>
            <Form.Item
              label="State*"
              name="state"
              rules={[{ message: 'Please input an asking price.' }]}
            >
              <Select
                label="State"
                defaultValue={state}
                onSelect={(e) => setState(e)}
                options={StateData}
                showSearch
              />
            </Form.Item>
            <Form.Item
              label="Zip Code*"
              name="zipCode"
              rules={[{ message: 'Please input a zip code.' }]}
            >
              <InputNumber
                precision={0}
                label="Zip Code"
                min={0}
                max={99999}
                defaultValue={zipCode}
                onChange={(e) => setZipCode(e)}
              />
            </Form.Item>

            <Form.Item
              label="Images"
              name="images"
              rules={[{ message: 'Please property upload images if avaliable.' }]}
            >
              <Upload
                action="https://www.mocky.io/v2/5cc8019d300000980a055e76"
                listType="picture-card"
                fileList={fileList}
                onPreview={handlePreview}
                onChange={handleChange}
              >{uploadButton}</Upload>
              <Modal open={previewOpen} title={previewTitle} footer={null} onCancel={handleCancel}>
                <img alt="example" style={{ width: '100%' }} src={previewImage} />
              </Modal>
            </Form.Item>

          </Form>)
          :
          (<div>
            <Button type="link" onClick={handleModalToggle}><ArrowLeftOutlined /></Button>
            <Form labelCol={{ span: 8 }} labelAlign='left'>
              <Form.Item
                label="Home Type*"
                name="homeType"
                rules={[{ message: 'Please input an asking price.' }]}
              >
              </Form.Item>
              <Form.Item
                label="Bedrooms*"
                name="bedrooms"
                rules={[{ message: 'Please input an asking price.' }]}
              >
              </Form.Item>
              <Form.Item
                label="Bathrooms*"
                name="bathrooms"
                rules={[{ message: 'Please input an asking price.' }]}
              >
              </Form.Item>
              <Form.Item
                label="Square Ft*"
                name="squareFeet"
                rules={[{ message: 'Please input an asking price.' }]}
              >
              </Form.Item>
              <Form.Item
                label="Year Built*"
                name="yearBuilt"
                rules={[{ message: 'Please input an asking price.' }]}
              >
              </Form.Item>
              <Form.Item
                label="Lot Size*"
                name="lotSize"
                rules={[{ message: 'Please input an asking price.' }]}
              >
              </Form.Item>
              <Form.Item
                label="Room Details"
                name="lotSize"
                rules={[{ message: 'Please input an asking price.' }]}
              >
              </Form.Item>

              <Form.Item
                label="Building Details"
                name="lotSize"
                rules={[{ message: 'Please input an asking price.' }]}
              >
              </Form.Item>

              <Form.Item
                label="Utilities*"
                name="lotSize"
                rules={[{ message: 'Please input an asking price.' }]}
              >
              </Form.Item>
            </Form>
          </div>)
        }
      </Modal>
      <PropertyCreateConfirmModal
        isCreateConfirmModalOpen={isCreateConfirmModalOpen}
        toggleCreateConfirmModal={toggleCreateConfirmModal}
        handleSubmitCreateProperty={handleSubmitCreateProperty}
      />
    </>
  )
}

export default PropertyCreateModal