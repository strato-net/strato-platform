import React, { useEffect, useState } from 'react';
import { useFormik, getIn } from 'formik';
import { Form, Modal, Input, Select, Radio, Button, Upload, Spin } from 'antd';
import TextArea from 'antd/es/input/TextArea';
import { PictureOutlined } from '@ant-design/icons';
import getSchema from './ProductSchema';

//sub-categories
import { useSubCategoryState } from '../../contexts/subCategory';
import { actions } from '../../contexts/product/actions';
import { useProductDispatch, useProductState } from '../../contexts/product';
import { UNIT_OF_MEASUREMENTS, unitOfMeasures } from '../../helpers/constants';
import TagManager from 'react-gtm-module';

const { Option } = Select;

const UpdateProductModal = ({
  open,
  handleCancel,
  categorys,
  productToUpdate,
  debouncedSearchTerm,
}) => {
  const schema = getSchema();
  const [formState, setFormState] = useState(null);
  const [selectedImage, setSelectedImage] = useState(null);
  const [isImgChanged, setIsImgChanged] = useState(false);
  const dispatch = useProductDispatch();

  //Sub-categories
  const { issubCategorysLoading } = useSubCategoryState();

  const { isproductUpdating, isupdateImageSubmitting } = useProductState();

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
    initialValues: formState || initialValues,
    validationSchema: schema,
    onSubmit: function (values, onSubmitProps) {
      handleUpdateFormSubmit(values);
    },
    enableReinitialize: true,
  });

  useEffect(() => {
    if (productToUpdate) {
      let nextState = {
        name: decodeURIComponent(productToUpdate.name),
        category: {
          name: productToUpdate.category,
        },
        subCategory: {
          name: productToUpdate.subCategory,
        },
        manufacturer: decodeURIComponent(productToUpdate.manufacturer),
        unitofmeasurement: {
          name: UNIT_OF_MEASUREMENTS[productToUpdate.unitOfMeasurement],
          value: productToUpdate.unitOfMeasurement,
        },
        leastSellableUnit: productToUpdate.leastSellableUnit,
        description: decodeURIComponent(productToUpdate.description),
        active: productToUpdate.isActive,
        image: productToUpdate.imageUrl,
        userUniqueProductCode: productToUpdate.userUniqueProductCode,
      };
      setFormState(nextState);
      setSelectedImage(productToUpdate.imageUrl);
    }
  }, [productToUpdate]);

  const handleUpdateFormSubmit = async (values) => {
    let imageData;
    if (isImgChanged) {
      const formData = new FormData();
      formData.append('fileUpload', formik.values.image);

      imageData = await actions.updateImage(
        dispatch,
        formData,
        productToUpdate.imageKey
      );
    } else {
      imageData = {
        imageKey: productToUpdate.imageKey,
      };
    }
    let body = {};

    if (imageData) {
      // If the image is changed we send the old image to be deleted.
      if (isImgChanged) {
        body = {
          productAddress: productToUpdate.address,
          updates: {
            description: encodeURIComponent(values.description),
            imageKey: imageData.imageKey,
            isActive: values.active,
            userUniqueProductCode: values.userUniqueProductCode,
            oldImageKey: productToUpdate.imageKey,
          },
        };
      } else {
        body = {
          productAddress: productToUpdate.address,
          updates: {
            description: encodeURIComponent(values.description),
            imageKey: imageData.imageKey,
            isActive: values.active,
            userUniqueProductCode: values.userUniqueProductCode,
          },
        };
      }
      window.LOQ.push([
        'ready',
        async (LO) => {
          await LO.$internal.ready('events');
          LO.events.track('Update Product');
        },
      ]);
      TagManager.dataLayer({
        dataLayer: {
          event: 'update_product',
        },
      });
      let isDone = await actions.updateProduct(dispatch, body);

      if (isDone) {
        setIsImgChanged(false);
        actions.fetchProduct(dispatch, 10, 0, debouncedSearchTerm);
        handleCancel();
      }
    }
  };

  const disabled = isproductUpdating || isupdateImageSubmitting;

  const closeModal = () => {
    handleCancel();
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
            id="update-product-button"
            className="w-40"
            key="submit"
            type="primary"
            onClick={formik.handleSubmit}
            disabled={disabled}
          >
            {disabled ? <Spin /> : 'Update Product'}
          </Button>
        </div>,
      ]}
    >
      <h1
        id="modal-title"
        className="text-center font-semibold text-lg text-primaryB"
      >
        Edit Product
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
                    setIsImgChanged(true);
                  }}
                  customRequest={() => {}}
                  style={{ display: 'none' }}
                  accept="image/png, image/jpeg"
                  maxCount={1}
                  showUploadList={false}
                >
                  <div className="text-primary border border-primary rounded px-4 py-2 text-center hover:text-white hover:bg-primary cursor-pointer">
                    Browse
                  </div>
                </Upload>
              </div>

              <div className="flex items-center">
                <p className="mt-1 text-xs italic font-medium ">Note:</p>
                <p className="mt-1 text-xs italic ml-1">use jpg, png format</p>
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
                  disabled={true}
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
                  placeholder="Select Category"
                  showSearch
                  allowClear
                  disabled={true}
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
                  showSearch
                  placeholder="Select Sub Category"
                  allowClear
                  disabled={true}
                  name="subCategory.name"
                  loading={issubCategorysLoading}
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
                  disabled={true}
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
                  placeholder="Select Unit of Measurement "
                  allowClear
                  name="unitofmeasurement"
                  disabled={true}
                  value={formik.values.unitofmeasurement}
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
                  disabled={true}
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
            <div className="flex justify-between mt-4 ">
              <Form.Item label="Active" name="active" className="mt-4">
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

export default UpdateProductModal;
