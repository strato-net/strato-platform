import React, { useState } from 'react';
import { useFormik, getIn } from 'formik';
import {
  Form,
  Modal,
  Input,
  Select,
  Radio,
  Button,
  Upload,
  Spin,
  notification,
} from 'antd';
import TextArea from 'antd/es/input/TextArea';
import { PictureOutlined } from '@ant-design/icons';
import getSchema from './ProductSchema';

//sub-categories
import { actions } from '../../contexts/product/actions';
import { useProductDispatch, useProductState } from '../../contexts/product';
import { unitOfMeasures } from '../../helpers/constants';
import TagManager from 'react-gtm-module';

const { Option } = Select;

const CreateProductModal = ({
  open,
  handleCancel,
  categorys,
  resetPage,
  page,
  debouncedSearchTerm,
}) => {
  const schema = getSchema();
  const [selectedImage, setSelectedImage] = useState(null);
  const dispatch = useProductDispatch();

  const { isCreateProductSubmitting, isuploadImageSubmitting } =
    useProductState();

  const initialValues = {
    image: null,
    name: '',
    category: {
      name: null,
      address: '',
    },
    subCategory: {
      name: null,
      address: '',
    },
    manufacturer: '',
    unitofmeasurement: {
      name: null,
      value: '',
    },
    leastSellableUnit: '',
    description: '',
    active: true,
    userUniqueProductCode: '',
  };

  const formik = useFormik({
    initialValues: initialValues,
    validationSchema: schema,
    onSubmit: function (values, onSubmitProps) {
      handleCreateFormSubmit(values);
    },
    enableReinitialize: true,
  });

  const handleCreateFormSubmit = async (values) => {
    const formData = new FormData();
    formData.append('fileUpload', formik.values.image);

    let imageData = await actions.uploadImage(dispatch, formData);
    if (imageData) {
      const body = {
        productArgs: {
          name: encodeURIComponent(values.name),
          description: encodeURIComponent(values.description),
          manufacturer: encodeURIComponent(values.manufacturer),
          unitOfMeasurement: values.unitofmeasurement.value,
          leastSellableUnit: parseInt(values.leastSellableUnit),
          imageKey: imageData.imageKey,
          isActive: values.active,
          category: values.category.name,
          subCategory: values.subCategory.name,
          userUniqueProductCode: values.userUniqueProductCode,
        },
      };
      window.LOQ.push([
        'ready',
        async (LO) => {
          await LO.$internal.ready('events');
          LO.events.track('Create Product', {
            product: values.name,
            category: values.category.name,
            subCategory: values.subCategory.name,
          });
        },
      ]);
      TagManager.dataLayer({
        dataLayer: {
          event: 'create_product',
        },
      });
      let isDone = await actions.createProduct(dispatch, body);

      if (isDone) {
        if (page === 1)
          actions.fetchProduct(dispatch, 10, 0, debouncedSearchTerm);
        resetPage(1);
        handleCancel();
      }
    }
  };

  const disabled = isCreateProductSubmitting || isuploadImageSubmitting;

  const closeModal = () => {
    handleCancel();
  };

  function beforeUpload(file) {
    const isJpgOrPng = file.type === 'image/jpeg' || file.type === 'image/png';
    if (!isJpgOrPng) {
      openToast('bottom', 'Image must be of jpeg or png format');
    }
    const isLt1M = file.size / 1024 / 1024 < 1;
    if (!isLt1M) {
      openToast('bottom', 'Cannot upload an image of size more than 1mb');
    }
    return isJpgOrPng && isLt1M;
  }

  const [api, contextHolder] = notification.useNotification();

  const openToast = (placement, message) => {
    api.error({
      message: message,
      onClose: actions.resetMessage(dispatch),
      placement,
      key: 2,
    });
  };

  return (
    <Modal
      open={open}
      centered
      onCancel={closeModal}
      width={885}
      footer={[
        <div className="flex justify-center">
          <Button
            className="w-40"
            id="create-product-button"
            key="submit"
            type="primary"
            onClick={formik.handleSubmit}
            disabled={disabled}
          >
            {disabled ? <Spin /> : 'Create Product'}
          </Button>
        </div>,
      ]}
    >
      {contextHolder}
      <h1
        id="modal-title"
        className="text-center font-semibold text-lg text-primaryB"
      >
        Add Product
      </h1>
      <hr className="text-secondryD mt-3" />
      <Form layout="vertical" className="mt-5">
        <div className="flex w-full">
          <div className="w-1/4">
            <Form.Item label="Upload Image" name="image">
              <div className="w-48 h-48 p-4 border-secondryD border rounded flex flex-col justify-around">
                {selectedImage ? (
                  <div className="h-20">
                    <img
                      alt="Product"
                      src={selectedImage}
                      style={{ width: '100%', height: '100%' }}
                    />
                    <br />
                  </div>
                ) : (
                  <PictureOutlined className="text-7xl text-primary opacity-10" />
                )}
                <Upload
                  onChange={(e) => {
                    setSelectedImage(URL.createObjectURL(e.file.originFileObj));
                    formik.setFieldValue('image', e.file.originFileObj);
                  }}
                  customRequest={() => {}}
                  style={{ display: 'none' }}
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
              {formik.touched.image && formik.errors.image && (
                <span className="text-error text-xs">
                  {formik.errors.image}
                </span>
              )}
            </Form.Item>
          </div>
          <div className="w-3/4 mb-3">
            <div className="flex justify-between ">
              <Form.Item label="Name" name="name" className="w-72">
                <Input
                  label="name"
                  name="name"
                  placeholder="Enter Name"
                  value={formik.values.name}
                  onChange={formik.handleChange}
                />
                {formik.touched.name && formik.errors.name && (
                  <span className="text-error text-xs">
                    {formik.errors.name}
                  </span>
                )}
              </Form.Item>
              <Form.Item label="Category" className="w-72">
                <Select
                  id="category"
                  placeholder="Select Category"
                  showSearch
                  allowClear
                  name="category.name"
                  value={formik.values.category.name}
                  onChange={(value) => {
                    formik.setFieldValue('category.name', value);
                    formik.setFieldValue('subCategory.name', null);
                  }}
                >
                  {categorys.map((e, index) => (
                    <Option value={e.name} key={index}>
                      {e.name}
                    </Option>
                  ))}
                </Select>
                {getIn(formik.touched, 'category.name') &&
                  getIn(formik.errors, 'category.name') && (
                    <span className="text-error text-xs">
                      {getIn(formik.errors, 'category.name')}
                    </span>
                  )}
              </Form.Item>
            </div>
            <div className="flex justify-between mt-4">
              <Form.Item
                label="Sub Category"
                name="subCategory"
                className="w-72"
              >
                <Select
                  id="subCategory"
                  showSearch
                  placeholder="Select Sub Category"
                  allowClear
                  name="subCategory.name"
                  value={formik.values.subCategory.name}
                  onChange={(value) => {
                    formik.setFieldValue('subCategory.name', value);
                  }}
                >
                  {categorys.map((category) =>
                    category.name === formik.values.category.name
                      ? category.subCategories.map((e, index) => (
                          <Option value={e.name} key={index}>
                            {e.name}
                          </Option>
                        ))
                      : null
                  )}
                </Select>
                {getIn(formik.touched, 'subCategory.name') &&
                  getIn(formik.errors, 'subCategory.name') && (
                    <span className="text-error text-xs">
                      {getIn(formik.errors, 'subCategory.name')}
                    </span>
                  )}
              </Form.Item>
              <Form.Item
                label="Manufacturer"
                name="manufacturer"
                className="w-72"
              >
                <Input
                  label="manufacturer"
                  placeholder="Enter Manufacturer"
                  name="manufacturer"
                  value={formik.values.manufacturer}
                  onChange={formik.handleChange}
                />
                {formik.touched.manufacturer && formik.errors.manufacturer && (
                  <span className="text-error text-xs">
                    {formik.errors.manufacturer}
                  </span>
                )}
              </Form.Item>
            </div>
            <div className="flex justify-between mt-4 ">
              <Form.Item
                label="Unit of Measurement "
                name="unitofmeasurement "
                className="w-72"
              >
                <Select
                  id="unitofmeasurement"
                  placeholder="Select Unit of Measurement "
                  allowClear
                  name="unitofmeasurement.name"
                  value={formik.values.unitofmeasurement.name}
                  onChange={(value) => {
                    let selectedUOM = unitOfMeasures.find(
                      (u) => u.value === value
                    );
                    formik.setFieldValue(
                      'unitofmeasurement.name',
                      selectedUOM.name
                    );
                    formik.setFieldValue('unitofmeasurement.value', value);
                  }}
                >
                  {unitOfMeasures.map((e, index) => (
                    <Option value={e.value} key={index}>
                      {e.name}
                    </Option>
                  ))}
                </Select>
                {getIn(formik.touched, 'unitofmeasurement.name') &&
                  getIn(formik.errors, 'unitofmeasurement.name') && (
                    <span className="text-error text-xs">
                      {getIn(formik.errors, 'unitofmeasurement.name')}
                    </span>
                  )}
              </Form.Item>
              <Form.Item
                label="Least Sellable Unit"
                name="leastSellableUnit"
                className="w-72"
              >
                <Input
                  label="leastSellableUnit"
                  name="leastSellableUnit"
                  value={formik.values.leastSellableUnit}
                  onChange={formik.handleChange}
                  placeholder="Enter Least Sellable Unit"
                />
                {formik.touched.leastSellableUnit &&
                  formik.errors.leastSellableUnit && (
                    <span className="text-error text-xs">
                      {formik.errors.leastSellableUnit}
                    </span>
                  )}
              </Form.Item>
            </div>
            <Form.Item label="Description" name="description" className="mt-4">
              <TextArea
                label="description"
                placeholder="Enter Description"
                name="description"
                value={formik.values.description}
                onChange={formik.handleChange}
              />
              {formik.touched.description && formik.errors.description && (
                <span className="text-error text-xs">
                  {formik.errors.description}
                </span>
              )}
            </Form.Item>
            <div className="flex justify-between mt-4 items-center">
              <Form.Item label="Active" name="active">
                <Radio.Group
                  value={formik.values.active}
                  onChange={formik.handleChange}
                  name="active"
                >
                  <Radio value={true}>Yes</Radio>
                  <Radio value={false}>No</Radio>
                </Radio.Group>

                {formik.touched.active && formik.errors.active && (
                  <span className="text-error text-xs">
                    {formik.errors.active}
                  </span>
                )}
              </Form.Item>
              <Form.Item
                label="Unique Product Code"
                name="userUniqueProductCode"
                className="w-72"
              >
                <Input
                  label="userUniqueProductCode"
                  placeholder="Enter Unique Product Code"
                  name="userUniqueProductCode"
                  value={formik.values.userUniqueProductCode}
                  onChange={formik.handleChange}
                />
                {formik.touched.userUniqueProductCode &&
                  formik.errors.userUniqueProductCode && (
                    <span className="text-error text-xs">
                      {formik.errors.userUniqueProductCode}
                    </span>
                  )}
              </Form.Item>
            </div>
          </div>
        </div>
      </Form>
    </Modal>
  );
};

export default CreateProductModal;
