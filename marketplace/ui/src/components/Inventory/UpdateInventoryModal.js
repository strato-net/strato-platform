import React, { useEffect, useState } from "react";
import { useFormik, getIn } from "formik";
import { Form, Modal, Input, Select, Radio, Button, Spin, Tag } from "antd";
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
import { INVENTORY_STATUS, PAYMENT_TYPE } from "../../helpers/constants";
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
  

  const { isinventoryUpdating, isReselling } =
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
    price: "",
    batchId: "",
    serialNumber: null,
    status: true,
    paymentTypes: [],
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
  
  const tagRender = (props) => {
    const { label, value, closable, onClose } = props;
    const onPreventMouseDown = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    return (
      <Tag
        onMouseDown={onPreventMouseDown}
        closable={closable}
        onClose={onClose}
        className="flex items-center mr-1"
      >
        {PAYMENT_TYPE[value].icon ? PAYMENT_TYPE[value].icon : <></>}
        <p className="ml-1">{label}</p>
      </Tag>
    );
  };
  
  const handleSelectAll = (value) => {
    if (value.includes(0)) {
      if (value.length === PAYMENT_TYPE.length) {
        formik.setFieldValue("paymentTypes", []);
        return []
      }
      formik.setFieldValue("paymentTypes", [1, 2, 3, 4, 5]);
      return [1, 2, 3, 4, 5];
    } else {
      formik.setFieldValue("paymentTypes", value);
      return value;
    }
  }

  useEffect(() => {
    if (inventoryToUpdate) {
      const data = inventoryToUpdate.inventory.data ? JSON.parse(inventoryToUpdate.inventory.data) : {};
      let nextState = {
        category: {
          name: getCategory(),
        },
        productName: {
          name: decodeURIComponent(inventoryToUpdate.inventory.name),
          address: inventoryToUpdate.inventory.productId,
        },
        availableQuantity: data?.units ?? null,
        price: inventoryToUpdate.inventory.price,
        batchId: inventoryToUpdate.inventory.batchId,
        serialNumber: null,
        status: inventoryToUpdate.inventory.status === 1 ? true : false,
      };
    
      setFormState(nextState);
    }
  }, [inventoryToUpdate]);

  const handleUpdateFormSubmit = async (values) => {
    if (inventoryToUpdate.inventory.status === 2 && values.status) {
      let body = {
        itemContract: getCategory(),
        itemAddress: inventoryToUpdate.inventory.address,
        paymentTypes: values.paymentTypes,
        price: values.price,
        units: values.availableQuantity
      };
      if (getCategory() === "Carbon") {
          body = {
              ...body,
              units: values.availableQuantity,
          }
      }
      let isDone = await actions.resellInventory(dispatch, body);
      if (isDone) {
          actions.fetchInventory(dispatch, 10, 0, "");
          handleCancel();
      }
    }
    else {
      const body = {
        itemContract: values.category.name,
        itemAddress: inventoryToUpdate.inventory.address,
        updates: {
          price: values.price,
          status: values.status ? INVENTORY_STATUS['PUBLISHED'] : INVENTORY_STATUS['UNPUBLISHED'],
        },
      };
  
      window.LOQ = window.LOQ || []
      window.LOQ.push(['ready', async LO => {
          // Track an event
          await LO.$internal.ready('events')
          LO.events.track('Update Inventory', {category: values.category.name, product: values.productName.name})
      }])
  
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
            {isinventoryUpdating || isReselling ? <Spin /> : "Update Inventory"}
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
                    formik.setFieldValue("category.name", value);
                    formik.setFieldValue("subCategory.name", null);
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
            </div>
            <div className="flex justify-between mt-4 ">
              <Form.Item label="Quantity" name="availableQuantity" className="w-72">
                <Input
                  label="availableQuantity"
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
              <Form.Item label="Payment Types" name="paymentTypes" className="w-72" getValueFromEvent={handleSelectAll}>
                  <Select
                    id="paymentTypes"
                    mode="multiple"
                    tagRender={tagRender}
                    placeholder="Select Payment Types"
                    allowClear
                    name="paymentTypes"
                    maxTagCount="responsive"
                    value={formik.values.paymentTypes}
                    onChange={handleSelectAll}
                    showSearch={false}
                    disabled={inventoryToUpdate.inventory.status === 1  || !formik.values.status}
                  >
                    {PAYMENT_TYPE.map((e, index) => (
                      <Option value={e.value} key={index}>
                        {e.name}
                      </Option>
                    ))}
                  </Select>
                  {getIn(formik.touched, "paymentTypes") &&
                    getIn(formik.errors, "paymentTypes") && (
                      <span className="text-error text-xs">
                        {getIn(formik.errors, "paymentTypes")}
                      </span>
                    )}
                </Form.Item>
            </div>
            <div className="flex justify-between mt-4 ">
                <Form.Item
                  label="Price Per Unit"
                  name="price "
                  className="w-72"
                >
                  <Input
                    label="price"
                    placeholder="Enter Price"
                    name="price"
                    value={formik.values.price}
                    onChange={formik.handleChange}
                    disabled={ !formik.values.status }
                  />
                  {formik.touched.price && formik.errors.price && (
                    <span className="text-error text-xs">
                      {formik.errors.price}
                    </span>
                  )}
                </Form.Item>

              <Form.Item label="Status" name="status" className="w-72">
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
              {/* <Form.Item label="Batch ID" name="batchId" className="w-72">
                <Input
                  label="batchId"
                  placeholder="Enter Batch ID"
                  name="batchId"
                  disabled={true}
                  value={formik.values.batchId}
                  onChange={formik.handleChange}
                />
                {formik.touched.batchId && formik.errors.batchId && (
                  <span className="text-error text-xs">
                    {formik.errors.batchId}
                  </span>
                )}
              </Form.Item> */}
            </div>
            <div className="flex justify-between mt-4 ">
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
            </div>
          </div>
        </Form>
      )}
    </Modal>
  );
};

export default UpdateInventoryModal;
