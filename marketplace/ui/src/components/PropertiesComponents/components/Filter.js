import React, { useState } from "react";
import {
  Row,
  Col,
  Typography,
  Collapse,
  Slider,
  InputNumber,
  Select,
  Checkbox,
  Drawer,
  Space,
  Button,
} from "antd";
import { FilterFilled, CloseOutlined } from "@ant-design/icons";
// import { actions } from '../../../contexts/propertyContext/actions';
import filterData from "../helpers/filterOptions.json";
// import { usePropertiesDispatch } from '../../../contexts/propertyContext';

const { Panel } = Collapse;

const Filter = () => {
  // const dispatch = usePropertiesDispatch()
  // const { properties, isPropertiesLoading } = usePropertiesState();

  const MAX_PRICE_VALUE = 2000000;
  const filterSchema = {
    sortBy: "Select",
    minPriceValue: 0,
    maxPriceValue: MAX_PRICE_VALUE,
    zipcodeValue: 0,
    stateValue: "Select",
    minBedrooms: 0,
    minBathrooms: 0,
    amenities: [],
    minSqFt: 0,
    parkingType: "Select",
    propertyType: "Select",
  };

  const [filterOption, setFilterOption] = useState(filterSchema);
  const [isDrawerOpen, setDrawerOpen] = useState(false);

  const handleChange = (key, value) => {
    let filter = { ...filterOption };
    filter[key] = value;
    setFilterOption(filter);
  };

  const openDrawer = () => {
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

  const handleClear = () => {
    setDrawerOpen(false);
    setFilterOption(filterSchema);
  };

  const applyFilter = () => {
    setDrawerOpen(false);
    // actions.fetchProperties(dispatch, 12,1,filterOption)
  };

  return (
    <>
      <Drawer
        placement="left"
        size={"default"}
        onClose={closeDrawer}
        open={isDrawerOpen}
      >
        <Row style={{ marginBottom: "20px" }}>
          <Col offset={2} span={10}>
            <Button onClick={handleClear} icon={<CloseOutlined />}>
              Clear Filter
            </Button>
          </Col>
          <Col offset={2} span={10}>
            <Button onClick={applyFilter} type="primary">
              Apply Filter{" "}
            </Button>
          </Col>
        </Row>
        <Typography.Title level={5}>Sort By</Typography.Title>
        <Select
          value={filterOption?.sortBy}
          style={{ width: "100%" }}
          onChange={(value) => {
            handleChange("sortBy", value);
          }}
          defaultValue={"Select"}
          options={[
            { value: "Select", label: "Select" },
            { value: "minPrice", label: "Sort By Lowest Price" },
            { value: "maxPrice", label: "Sort By Highest Price" },
            { value: "minSqFt", label: "Sort By Lowest Sq Ft." },
            { value: "maxSqFt", label: "Sort By Highest Sq Ft." },
          ]}
        />

        <Typography.Title level={5} style={{ marginTop: "15px" }}>
          Filter By
        </Typography.Title>
        <Collapse
          expandIconPosition={"end"}
          defaultActiveKey={["1", "2", "3", "4", "5"]}
        >
          <Panel style={{ fontWeight: 700 }} header="Price Range" key="1">
            <Typography.Title
              level={5}
              style={{ marginTop: 0 }}
              ellipsis={{ tooltip: true }}
            >
              Min Price
            </Typography.Title>
            <Slider
              step={50000}
              min={0}
              max={filterOption?.maxPriceValue}
              type="number"
              onChange={(value) => {
                handleChange("minPriceValue", value);
              }}
              value={
                typeof filterOption?.minPriceValue === "number"
                  ? filterOption?.minPriceValue
                  : 0
              }
            />
            <InputNumber
              min={0}
              max={filterOption?.maxPriceValue}
              type="number"
              style={{ width: "100%" }}
              placeholder="Min Price"
              value={filterOption?.minPriceValue}
              controls={false}
              onChange={(value) => {
                handleChange("minPriceValue", value);
              }}
              onWheel={(e) => e.target.blur()}
            />
            <Typography.Title
              level={5}
              style={{ marginTop: 5 }}
              ellipsis={{ tooltip: true }}
            >
              Max Price
            </Typography.Title>
            <Slider
              step={50000}
              min={0}
              max={2000000}
              type="number"
              onChange={(value) => {
                handleChange("maxPriceValue", value);
              }}
              value={
                typeof filterOption?.maxPriceValue === "number"
                  ? filterOption?.maxPriceValue
                  : 0
              }
            />
            <InputNumber
              min={0}
              max={2000000}
              type="number"
              style={{ width: "100%" }}
              placeholder="Max Price"
              value={filterOption?.maxPriceValue}
              controls={false}
              onChange={(value) => {
                handleChange("maxPriceValue", value);
              }}
              onWheel={(e) => e.target.blur()}
            />
          </Panel>
          <Panel style={{ fontWeight: 700 }} header="Location" key="2">
            <Typography.Title
              level={5}
              style={{ marginTop: 0 }}
              ellipsis={{ tooltip: true }}
            >
              Zip Code
            </Typography.Title>
            <InputNumber
              min={0}
              max={99999}
              type="number"
              value={filterOption?.zipcodeValue}
              style={{ width: "100%" }}
              placeholder="Enter Zipcode"
              controls={false}
              onChange={(value) => {
                handleChange("zipcodeValue", value);
              }}
              onWheel={(e) => e.target.blur()}
            />
            <Typography.Title
              level={5}
              style={{ marginTop: 5 }}
              ellipsis={{ tooltip: true }}
            >
              State
            </Typography.Title>
            <Select
              style={{ width: "100%" }}
              value={filterOption?.stateValue}
              onChange={(value) => {
                handleChange("stateValue", value);
              }}
              defaultValue={"Select"}
              options={filterData?.states}
            />
          </Panel>

          <Panel
            style={{ fontWeight: 700 }}
            header="Bedrooms & Bathrooms"
            key="3"
          >
            <Typography.Title
              level={5}
              style={{ marginTop: 0 }}
              ellipsis={{ tooltip: true }}
            >
              Min Bedrooms
            </Typography.Title>
            <Slider
              step={1}
              min={0}
              max={7}
              onChange={(value) => {
                handleChange("minBedrooms", value);
              }}
              value={
                typeof filterOption?.minBedrooms === "number"
                  ? filterOption?.minBedrooms
                  : 0
              }
            />
            <InputNumber
              min={0}
              max={7}
              type="number"
              style={{ width: "100%" }}
              placeholder="Min Bedrooms"
              value={filterOption?.minBedrooms}
              controls={false}
              onChange={(value) => {
                handleChange("minBedrooms", value);
              }}
              onWheel={(e) => e.target.blur()}
            />
            <Typography.Title
              level={5}
              style={{ marginTop: 0 }}
              ellipsis={{ tooltip: true }}
            >
              Min Bathrooms
            </Typography.Title>
            <Slider
              step={1}
              min={0}
              max={7}
              onChange={(value) => {
                handleChange("minBathrooms", value);
              }}
              value={
                typeof filterOption?.minBathrooms === "number"
                  ? filterOption?.minBathrooms
                  : 0
              }
            />
            <InputNumber
              min={0}
              max={7}
              type="number"
              style={{ width: "100%" }}
              placeholder="Min Bathrooms"
              value={filterOption?.minBathrooms}
              controls={false}
              onChange={(value) => {
                handleChange("minBathrooms", value);
              }}
              onWheel={(e) => e.target.blur()}
            />
          </Panel>

          <Panel style={{ fontWeight: 700 }} header="Amenities" key="4">
            {/* <div style={{ display: "flex", flexDirection: "column" }}> */}
            <Checkbox.Group
              style={{ display: "grid", lineHeight: "30px" }}
              options={filterData?.amenities}
              value={filterOption?.amenities}
              onChange={(value) => {
                handleChange("amenities", value);
              }}
            />
            {/* </div> */}
          </Panel>

          <Panel style={{ fontWeight: 700 }} header="Sq. Footage" key="5">
            <Typography.Title
              level={5}
              style={{ marginTop: 0 }}
              ellipsis={{ tooltip: true }}
            >
              Min Sq Ft.
            </Typography.Title>
            <InputNumber
              min={0}
              type="number"
              style={{ width: "100%" }}
              placeholder="Min Sq Ft."
              value={filterOption?.minSqFt}
              controls={false}
              onChange={(value) => {
                handleChange("minSqFt", value);
              }}
              onWheel={(e) => e.target.blur()}
            />
          </Panel>
          <Panel
            style={{ fontWeight: 700 }}
            header="Property & Parking"
            key="6"
          >
            <Typography.Title
              level={5}
              style={{ marginTop: 5 }}
              ellipsis={{ tooltip: true }}
            >
              Parking
            </Typography.Title>
            <Select
              style={{ width: "100%" }}
              value={filterOption?.parkingType}
              onChange={(value) => {
                handleChange("parkingType", value);
              }}
              defaultValue={"Select"}
              options={filterData?.parkingType}
            />

            <Typography.Title
              level={5}
              style={{ marginTop: 5 }}
              ellipsis={{ tooltip: true }}
            >
              Property
            </Typography.Title>
            <Select
              style={{ width: "100%" }}
              value={filterOption?.propertyType}
              onChange={(value) => {
                handleChange("propertyType", value);
              }}
              defaultValue={"Select"}
              options={filterData?.propertyTypes}
            />
          </Panel>
        </Collapse>
      </Drawer>

      <Row>
        <Col span={1}></Col>
        <Col span={22}>
          <Typography.Title level={4} style={{ margin: "0px 18px" }}>
            {/* Properties for you */}
            <Space style={{ marginLeft: "15px" }}>
              <Button icon={<FilterFilled />} onClick={openDrawer}>
                Filter
              </Button>
            </Space>
          </Typography.Title>
        </Col>
        <Col span={1}></Col>
      </Row>
    </>
  );
};

export default Filter;
