import React, { useEffect, useState } from "react";
import { useFormik, getIn } from "formik";
import { Form, Modal, Input, Select, Radio, Button, Spin } from "antd";
import getSchema from "./UpdateInventorySchema";
import { actions } from "../../contexts/inventory/actions";
import {
  useInventoryDispatch,
  useInventoryState,
} from "../../contexts/inventory";
import {
  useCategoryDispatch,
  useCategoryState,
} from "../../contexts/category";
import { actions as categoryActions } from "../../contexts/category/actions";
import { useProductState } from "../../contexts/product";
import { INVENTORY_STATUS } from "../../helpers/constants";
import TagManager from "react-gtm-module";


const { Option } = Select;

const UpdateInventoryModal = ({
  open,
  handleCancel,
  debouncedSearchTerm,
  inventoryToUpdate,
}) => {
  const schema = getSchema();
  const [formState, setFormState] = useState(null);
  const dispatch = useInventoryDispatch();
  const categoryDispatch = useCategoryDispatch();

  const { categorys, iscategorysLoading } = useCategoryState();
  const { categoryBasedProducts, isCategoryBasedProductsLoading } =
    useProductState();


  const { isinventoryUpdating } =
    useInventoryState();

  const initialValues = {
    category: {
      name: null,
      address: null,
    },
    productName: {
      name: null,
      address: "",
    },
    availableQuantity: null,
    pricePerUnit: "",
    vintage: null,
    serialNumber: null,
    status: true,
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

  useEffect(() => {
    if (inventoryToUpdate) {
      let nextState = {
        category: {
          name: inventoryToUpdate.category.name,
        },
        productName: {
          name: inventoryToUpdate.inventory.name,
          address: inventoryToUpdate.inventory.productId,
        },
        availableQuantity: inventoryToUpdate.inventory.availableQuantity,
        pricePerUnit: inventoryToUpdate.inventory.pricePerUnit,
        vintage: inventoryToUpdate.inventory.vintage,
        serialNumber: null,
        status: inventoryToUpdate.inventory.status === 1 ? true : false,
      };

      setFormState(nextState);
    }
  }, [inventoryToUpdate]);

  const handleUpdateFormSubmit = async (values) => {
    const body = {
      productAddress: values.productName.address,
      inventory: inventoryToUpdate.inventory.address,
      updates: {
        pricePerUnit: values.pricePerUnit,
        status: values.status ? INVENTORY_STATUS['PUBLISHED'] : INVENTORY_STATUS['UNPUBLISHED'],
      },
    };

    TagManager.dataLayer({
      dataLayer: {
        event: 'update_inventory',
      },
    });
    let isDone = await actions.updateInventory(dispatch, body);

    if (isDone) {
      actions.fetchInventory(dispatch, 10, 0, debouncedSearchTerm);
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
            {isinventoryUpdating ? <Spin /> : "Update Inventory"}
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
            <div className="flex justify-between ">
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
                    formik.setFieldValue("category.name", value);
                  }}
                >
                  {categorys.map((e, index) => (
                    <Option value={e.name} key={index}>
                      {e.name}
                    </Option>
                  ))}
                </Select>
                {getIn(formik.touched, "category.name") &&
                  getIn(formik.errors, "category.name") && (
                    <span className="text-error text-xs">
                      {getIn(formik.errors, "category.name")}
                    </span>
                  )}
              </Form.Item>
              <Form.Item label="Quantity" name="availableQuantity" className="w-72">
                <Input
                  label="quantity"
                  placeholder="Enter Quantity"
                  name="availableQuantity"
                  disabled={true}
                  value={formik.values.availableQuantity}
                  onChange={formik.handleChange}
                />
                {formik.touched.availableQuantity && formik.errors.availableQuantity && (
                  <span className="text-error text-xs">
                    {formik.errors.availableQuantity}
                  </span>
                )}
              </Form.Item>
            </div>
            <div className="flex justify-between mt-4 ">
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
                    let selectedProduct = { address: "" };
                    if (value) {
                      selectedProduct = categoryBasedProducts.find(
                        (e) => e.name === value
                      );
                    }
                    formik.setFieldValue("productName.name", value);
                    formik.setFieldValue(
                      "productName.address",
                      selectedProduct.address
                    );
                    formik.setFieldTouched("productName.name", false, false);
                  }}
                >
                  {categoryBasedProducts.map((e, index) => (
                    <Option value={e.name} key={index}>
                      {e.name}
                    </Option>
                  ))}
                </Select>

                {getIn(formik.touched, "productName.name") &&
                  getIn(formik.errors, "productName.name") && (
                    <span className="text-error text-xs">
                      {getIn(formik.errors, "productName.name")}
                    </span>
                  )}
              </Form.Item>
              <Form.Item
                label="Vintage"
                name="vintage"
                className="w-72"
              >
                <Input
                  label="vintage"
                  placeholder="Enter Vintage"
                  name="vintage"
                  value={formik.values.vintage}
                  onChange={formik.handleChange}
                  disabled={true}
                />
                {formik.touched.vintage && formik.errors.vintage && (
                  <span className="text-error text-xs">
                    {formik.errors.vintage}
                  </span>
                )}
              </Form.Item>
            </div>
            <div className="flex justify-between mt-4 ">
              <Form.Item
                label="Price Per Unit"
                name="pricePerUnit "
                className="w-72"
              >
                <Input
                  label="pricePerUnit"
                  placeholder="Enter Price"
                  name="pricePerUnit"
                  value={formik.values.pricePerUnit}
                  onChange={formik.handleChange}
                  disabled={true}
                />
                {formik.touched.pricePerUnit && formik.errors.pricePerUnit && (
                  <span className="text-error text-xs">
                    {formik.errors.pricePerUnit}
                  </span>
                )}
              </Form.Item>
            </div>
            {/* <div className="mt-4 flex justify-between items-center">
              <div>Enter Serial Numbers</div>
            </div>
            <TextArea
              label="serialNumbers"
              className="mt-2"
              disabled={true}
              // value={formik.values.serialNumber}
              placeholder="Enter serial numbers as comma separated values 1232WE13W43,1232WE13W434,1232WE13W45"
            /> */}
            <Form.Item label="Status" name="status" className="mt-4">
              <Radio.Group
                value={formik.values.status}
                onChange={formik.handleChange}
                name="status"
              >
                <Radio value={true}>Publish</Radio>
                <Radio value={false}>Unpublish</Radio>
              </Radio.Group>

              {formik.touched.status && formik.errors.status && (
                <span className="text-error text-xs">
                  {formik.errors.status}
                </span>
              )}
            </Form.Item>
          </div>
        </Form>
      )}
    </Modal>
  );
};

export default UpdateInventoryModal;
