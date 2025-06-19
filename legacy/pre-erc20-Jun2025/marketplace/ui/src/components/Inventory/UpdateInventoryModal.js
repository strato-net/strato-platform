import React, { useEffect, useState } from 'react';
import { useFormik, getIn } from 'formik';
import { Form, Modal, Input, Select, Radio, Button, Spin, Tag } from 'antd';
import getSchema from './UpdateInventorySchema';
import { actions } from '../../contexts/inventory/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import { useCategoryDispatch, useCategoryState } from '../../contexts/category';
import { actions as categoryActions } from '../../contexts/category/actions';
import { useProductState } from '../../contexts/product';
import TagManager from 'react-gtm-module';
import { useAuthenticateState } from '../../contexts/authentication';

const { Option } = Select;

const UpdateInventoryModal = ({
  open,
  handleCancel,
  debouncedSearchTerm,
  inventoryToUpdate,
  categoryName,
  limit,
  offset,
}) => {
  const schema = getSchema();
  const [formState, setFormState] = useState(null);
  const dispatch = useInventoryDispatch();
  const categoryDispatch = useCategoryDispatch();

  const { categorys, iscategorysLoading } = useCategoryState();
  const { categoryBasedProducts, isCategoryBasedProductsLoading } =
    useProductState();

  const { user } = useAuthenticateState();
  const { isinventoryUpdating, isReselling } = useInventoryState();

  const initialValues = {
    category: {
      name: null,
      address: null,
    },
    productName: {
      name: null,
      address: '',
    },
    availableQuantity: null,
    batchId: '',
  };

  const formik = useFormik({
    initialValues: formState || initialValues,
    validationSchema: schema,
    onSubmit: function (values) {
      handleUpdateFormSubmit(values);
    },
    enableReinitialize: true,
  });

  useEffect(() => {
    categoryActions.fetchCategories(categoryDispatch);
  }, [categoryDispatch]);

  const getCategory = () => {
    const parts = inventoryToUpdate.inventory.contract_name.split('-');
    return parts[parts.length - 1];
  };

  useEffect(() => {
    if (inventoryToUpdate) {
      const data = inventoryToUpdate.inventory.data
        ? inventoryToUpdate.inventory.data
        : {};
      let nextState = {
        category: {
          name: getCategory(),
        },
        productName: {
          name: decodeURIComponent(inventoryToUpdate.inventory.name),
          address: inventoryToUpdate.inventory.productId,
        },
        availableQuantity: data?.quantity ?? null,
        batchId: inventoryToUpdate.inventory.batchId,
      };

      setFormState(nextState);
    }
  }, [inventoryToUpdate]);

  const handleUpdateFormSubmit = async (values) => {
    const body = {
      itemContract: values.category.name,
      itemAddress: inventoryToUpdate.inventory.address,
      updates: {},
    };

    window.LOQ = window.LOQ || [];
    window.LOQ.push([
      'ready',
      async (LO) => {
        // Track an event
        await LO.$internal.ready('events');
        LO.events.track('Update Inventory', {
          category: values.category.name,
          product: values.productName.name,
        });
      },
    ]);

    TagManager.dataLayer({
      dataLayer: {
        event: 'update_inventory',
      },
    });
    let isDone = await actions.updateInventory(dispatch, body);

    if (isDone) {
      await actions.fetchInventory(
        dispatch,
        limit,
        offset,
        debouncedSearchTerm,
        categoryName
      );
      await actions.fetchInventoryForUser(
        inventoryDispatch,
        10000,
        0,
        '',
        undefined
      );

      handleCancel();
    }
  };

  return (
    <Modal
      open={open}
      centered
      onCancel={handleCancel}
      width={673}
      footer={[
        <div className="flex justify-center">
          <Button
            className="w-40"
            key="submit"
            type="primary"
            onClick={formik.handleSubmit}
            disabled={isinventoryUpdating}
          >
            {isinventoryUpdating || isReselling ? <Spin /> : 'Update Inventory'}
          </Button>
        </div>,
      ]}
    >
      <h1 className="text-center font-semibold text-lg text-primaryB">
        Edit Inventory
      </h1>
      <hr className="text-secondryD mt-3" />
      {inventoryToUpdate && iscategorysLoading ? (
        <div className="h-44 flex justify-center items-center">
          <Spin spinning={iscategorysLoading} size="large" />
        </div>
      ) : (
        <Form layout="vertical" className="mt-5" onSubmit={formik.handleSubmit}>
          <div className="w-full mb-3">
            <div className="flex justify-between mt-4 ">
              <Form.Item label="Category" name="category" className="w-72">
                <Select
                  placeholder="Select Category"
                  showSearch
                  allowClear
                  id="category"
                  name="category.name"
                  disabled={true}
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
              <Form.Item
                label="Product Name"
                name="productName"
                className="w-72"
              >
                <Select
                  placeholder="Select Product"
                  allowClear
                  showSearch
                  id="product"
                  value={formik.values.productName.name}
                  name="productName.name"
                  loading={isCategoryBasedProductsLoading}
                  disabled={true}
                  onChange={(value) => {
                    let selectedProduct = { address: '' };
                    if (value) {
                      selectedProduct = categoryBasedProducts.find(
                        (e) => e.name === value
                      );
                    }
                    formik.setFieldValue('productName.name', value);
                    formik.setFieldValue(
                      'productName.address',
                      selectedProduct.address
                    );
                    formik.setFieldTouched('productName.name', false, false);
                  }}
                >
                  {categoryBasedProducts.map((e, index) => (
                    <Option value={e.name} key={index}>
                      {e.name}
                    </Option>
                  ))}
                </Select>

                {getIn(formik.touched, 'productName.name') &&
                  getIn(formik.errors, 'productName.name') && (
                    <span className="text-error text-xs">
                      {getIn(formik.errors, 'productName.name')}
                    </span>
                  )}
              </Form.Item>
            </div>
            <div className="flex justify-between mt-4 ">
              <Form.Item
                label="Quantity"
                name="availableQuantity"
                className="w-72"
              >
                <Input
                  label="availableQuantity"
                  placeholder="Enter Quantity"
                  name="availableQuantity"
                  disabled={true}
                  value={formik.values.availableQuantity}
                  onChange={formik.handleChange}
                />
                {formik.touched.availableQuantity &&
                  formik.errors.availableQuantity && (
                    <span className="text-error text-xs">
                      {formik.errors.availableQuantity}
                    </span>
                  )}
              </Form.Item>
            </div>
          </div>
        </Form>
      )}
    </Modal>
  );
};

export default UpdateInventoryModal;
