import React, { useEffect, useState } from "react";
import { useFormik, getIn } from "formik";
import { DownloadOutlined, PaperClipOutlined } from "@ant-design/icons";
import {
  Form,
  Modal,
  Input,
  Select,
  Radio,
  Button,
  Spin,
  Upload,
  notification
} from "antd";
import { Link } from "react-router-dom";
import TextArea from "antd/es/input/TextArea";
import getSchema from "./InventorySchema";
import { actions } from "../../contexts/inventory/actions";
import {
  useInventoryDispatch,
  useInventoryState,
} from "../../contexts/inventory";
import { actions as productActions } from "../../contexts/product/actions";
import { useProductDispatch, useProductState } from "../../contexts/product";
import { usePapaParse } from "react-papaparse";
import { INVENTORY_STATUS, MAX_RAW_MATERIAL } from "../../helpers/constants";

const { Option } = Select;

const CreateInventoryModal = ({
  open,
  handleCancel,
  categorys,
  debouncedSearchTerm,
  resetPage,
  page
}) => {
  const schema = getSchema();
  const dispatch = useInventoryDispatch();
  const productDispatch = useProductDispatch();
  const { readString } = usePapaParse();
  const [api, contextHolder] = notification.useNotification();
  const [uploadErr, setUploadErr] = useState("");

  const { categoryBasedProducts, isCategoryBasedProductsLoading } = useProductState();
  const { isCreateInventorySubmitting } = useInventoryState();

  const initialValues = {
    category: {
      name: null,
      address: null,
    },
    productName: {
      name: null,
      address: "",
    },
    quantity: null,
    pricePerUnit: "",
    vintage: 0,
    batchSerializationNumber: " ",
    status: true,
  };

  const formik = useFormik({
    initialValues: initialValues,
    validationSchema: schema,
    onSubmit: function (values) {
      // if (
      //   (values.serialNumber.serialNumArr.length === parseInt(values.quantity)) ||
      //   // Serial numbers are optional, we can submit the form if there are none. 
      //   (values.serialNumber.serialNumArr.length === 0)
      // ) {
      handleCreateFormSubmit(values);
      // } else {
      //   setUploadErr(
      //     "Quantity of items and number of serial numbers should be same"
      //   );
      // }
    },
    enableReinitialize: true,
  });

  useEffect(() => {
    if (formik.values.category.name) {
      productActions.fetchCategoryBasedProduct(
        productDispatch,
        formik.values.category.name
      );
    }
  }, [productDispatch, formik.values.category.name]);

  const handleCreateFormSubmit = async (values) => {
    const body = {
      productAddress: values.productName.address,
      quantity: parseInt(values.quantity),
      pricePerUnit: values.pricePerUnit,
      vintage: parseInt(values.vintage),
      status: values.status ? INVENTORY_STATUS['PUBLISHED'] : INVENTORY_STATUS['UNPUBLISHED'],
      batchSerializationNumber: " ",
    };

    let isDone = await actions.createInventory(dispatch, body);

    if (isDone) {
      if (page === 1)
        actions.fetchInventory(dispatch, 10, 0, debouncedSearchTerm);
      resetPage(1);
      handleCancel();
    }
  };

  const uploadCSV = (e) => {
    const csvFile = e.file.originFileObj;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const contents = readString(reader.result, { header: true });

      if (contents.data.length === 0) {
        setUploadErr("No records to import");
        return;
      }


      if (!Object.hasOwn(contents.data[0], "ItemSerialNumber")) {
        setUploadErr("Missing required column 'ItemSerialNumber'");
        return;
      }

      if (!Object.hasOwn(contents.data[0], "RawMaterialProductName")) {
        setUploadErr("Missing required column 'RawMaterialProductName'");
        return;
      }

      if (!Object.hasOwn(contents.data[0], "RawMaterialProductId")) {
        setUploadErr("Missing required column 'RawMaterialProductId'");
        return;
      }

      for (let j = 1; j <= MAX_RAW_MATERIAL; j++) {
        if (!Object.hasOwn(contents.data[0], `RawMaterialSerialNumber${j}`)) {
          setUploadErr(`Missing required column 'RawMaterialSerialNumber${j}'`);
          return;
        }
      }

      let serialNumbers = "", serialNumArr = [];
      for (let i = 0; i < contents.data.length; i++) {
        const row = contents.data[i];
        let rawMaterialSerials = [];
        let isAlreadyPresent = serialNumArr.find(elem => elem.itemSerialNumber === row["ItemSerialNumber"]);
        if (row["ItemSerialNumber"]) {
          if (row["RawMaterialProductName"]) {
            if (!row['RawMaterialProductId']) {
              setUploadErr("Missing value - 'RawMaterialProductId'");
              return;
            }

            for (let j = 1; j <= MAX_RAW_MATERIAL; j++) {
              if (row[`RawMaterialSerialNumber${j}`]) {
                rawMaterialSerials.push(row[`RawMaterialSerialNumber${j}`])
              } else {
                if (j === 1) {
                  setUploadErr("Missing value - 'RawMaterialSerialNumber1'");
                  return;
                }
              }
            }
          }

          let itemRecord;

          if (isAlreadyPresent) {


            itemRecord = {
              itemSerialNumber: row["ItemSerialNumber"],
              rawMaterials: row["RawMaterialProductName"] === undefined || row["RawMaterialProductName"] === "" ? [] : [{
                rawMaterialProductName: encodeURIComponent(row['RawMaterialProductName']),
                rawMaterialProductId: row["RawMaterialProductId"],
                rawMaterialSerialNumbers: [...rawMaterialSerials]
              }, ...isAlreadyPresent["rawMaterials"]]
            };
            let actualIndex = serialNumArr.findIndex(e => e.itemSerialNumber === row['ItemSerialNumber']);
            serialNumArr[actualIndex] = itemRecord;
          } else {
            itemRecord = {
              itemSerialNumber: row["ItemSerialNumber"],
              rawMaterials: row["RawMaterialProductName"] === undefined || row["RawMaterialProductName"] === "" ? [] : [{
                rawMaterialProductName: encodeURIComponent(row['RawMaterialProductName']),
                rawMaterialSerialNumbers: rawMaterialSerials,
                rawMaterialProductId: row["RawMaterialProductId"],
              }]
            };
            serialNumArr.push(itemRecord);
            serialNumbers += row["ItemSerialNumber"] + ",";
          }
        }
      }

      serialNumbers = serialNumbers.substring(0, serialNumbers.length - 1);
      formik.setFieldValue("serialNumber.serialNumStr", serialNumbers);
      formik.setFieldValue("serialNumber.serialNumArr", serialNumArr);
    };
    reader.readAsText(csvFile);
  };

  const openToast = (placement) => {
    api.error({
      message: uploadErr,
      onClose: setUploadErr(""),
      placement,
      key: 1,
    });
  };

  return (
    <>
      {contextHolder}
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
              disabled={isCreateInventorySubmitting}
            >
              {isCreateInventorySubmitting ? <Spin /> : "Create Inventory"}
            </Button>
          </div>,
        ]}
      >
        <h1 className="text-center font-semibold text-lg text-primaryB">
          Add Inventory
        </h1>
        <hr className="text-secondryD mt-3" />
        <Form
          layout="vertical"
          className="mt-5"
          onSubmit={formik.handleSubmit}
        >
          <div className="w-full mb-3">
            <div className="flex justify-between ">
              <Form.Item label="Category" name="category" className="w-72">
                <Select
                  placeholder="Select Category"
                  showSearch
                  allowClear
                  id="category"
                  name="category.name"
                  disabled={false}
                  value={formik.values.category.name}
                  onChange={(value) => {
                    formik.setFieldValue("category.name", value);
                    formik.setFieldTouched("category.name", false, false);

                    if (formik.values.productName.name) {
                      formik.setFieldValue("productName.name", null);
                    }
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
              <Form.Item label="Quantity" name="quantity" className="w-72">
                <Input
                  label="quantity"
                  placeholder="Enter Quantity"
                  name="quantity"
                  disabled={false}
                  value={formik.values.quantity}
                  onChange={formik.handleChange}
                />
                {formik.touched.quantity && formik.errors.quantity && (
                  <span className="text-error text-xs">
                    {formik.errors.quantity}
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
                  disabled={
                    !formik.values.category.name || isCategoryBasedProductsLoading
                  }
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
                      {decodeURIComponent(e.name)}
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
                />
                {formik.touched.pricePerUnit &&
                  formik.errors.pricePerUnit && (
                    <span className="text-error text-xs">
                      {formik.errors.pricePerUnit}
                    </span>
                  )}
              </Form.Item>
            </div>
            { formik.values.category.name === "Carbon"  && 
              <div className="flex justify-between mt-4 ">
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
                  />
                  {formik.touched.vintage &&
                    formik.errors.vintage && (
                      <span className="text-error text-xs">
                        {formik.errors.vintage}
                      </span>
                    )}
                </Form.Item>
              </div>
            }
            {/* <div className="mt-4 flex justify-between items-center">
              <div>Serial Numbers</div>
              <div className="flex items-center">
                <Link to="/sample.csv" target="_blank" download>
                  <div className="flex items-center" >
                    <DownloadOutlined className="text-primary text-sm font-medium cursor-pointer hover:text-primaryHover" />
                    <div className="text-primary ml-2 text-xs font-medium cursor-pointer hover:text-primaryHover">
                      Download Sample CSV
                    </div>
                  </div>
                </Link>
                <Upload
                  onChange={uploadCSV}
                  accept=".csv"
                  customRequest={() => { }}
                  showUploadList={false}
                >
                  <div className="ml-8 flex items-center">
                    <PaperClipOutlined className="text-primary text-sm font-medium cursor-pointer hover:text-primaryHover" />
                    <div className="text-primary ml-2 text-xs font-medium cursor-pointer hover:text-primaryHover">
                      Upload CSV
                    </div>
                  </div>
                </Upload>
              </div>
            </div> */}
            {/* <Form.Item>
              <TextArea
                label="serialNumbers"
                className="mt-2"
                disabled={true}
                rows={4}
                value={formik.values.serialNumber.serialNumStr}
                placeholder="Upload serial numbers using upload CSV option"
              />
              {getIn(formik.touched, "serialNumber.serialNumStr") &&
                getIn(formik.errors, "serialNumber.serialNumStr") && (
                  <span className="text-error text-xs">
                    {getIn(formik.errors, "serialNumber.serialNumStr")}
                  </span>
                )}
              {getIn(formik.touched, "serialNumber.serialNumArr") &&
                getIn(formik.errors, "serialNumber.serialNumArr") && (
                  <span className="text-error text-xs">
                    {getIn(formik.errors, "serialNumber.serialNumArr")}
                  </span>
                )}
            </Form.Item> */}
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
      </Modal>
      {uploadErr && openToast("bottom")}
    </>
  );
};

export default CreateInventoryModal;
