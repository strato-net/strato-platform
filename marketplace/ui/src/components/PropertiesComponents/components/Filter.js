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
import { FilterFilled, ClearOutlined } from "@ant-design/icons";
import filterData from "../helpers/filterOptions.json";
import { propertyConstants } from "../helpers/constants";

const { Panel } = Collapse;

const Filter = (props) => {
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const { filterOption } = props;

  const { sortBy, states, amenities, parkingType, propertyTypes } = filterData;
  const { maxPriceValue, postalcode, minPriceValue, stateOrProvince, bedroomsTotal, bathroomsTotalInteger, lotSizeArea, } = filterOption;

  const handleChange = (key, value) => {
    props.handleChange(key, value)
  };

  const openDrawer = () => {
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
  };

  const handleClear = () => {
    // setDrawerOpen(false);
    // setFilterOption(filterSchema);
    props.clearFilter()
  };

  const applyFilter = () => {
    setDrawerOpen(false);
    props.applyFilter()
  };

  return (
    <>
      <Drawer
        placement="left"
        size={"default"}
        onClose={closeDrawer}
        open={isDrawerOpen}
        extra={
          <Space>
            <Button onClick={handleClear} icon={<ClearOutlined />}>
              Clear
            </Button>
            <Button onClick={applyFilter} type="primary">
              Apply
            </Button>
          </Space>
        }
      >
        <Typography.Title level={5}>Sort By</Typography.Title>
        <Select
          value={filterOption?.sortBy}
          style={{ width: "100%" }}
          onChange={(value) => {
            handleChange("sortBy", value);
          }}
          options={sortBy}
        />

        <Typography.Title level={5} style={{ marginTop: "15px" }}>
          Filter By
        </Typography.Title>
        <Collapse
          expandIconPosition={"end"}
          defaultActiveKey={["1", "2"]}
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
              max={maxPriceValue}
              type="number"
              onChange={(value) => {
                handleChange("minPriceValue", value);
              }}
              value={
                typeof minPriceValue === "number"
                  ? minPriceValue
                  : 0
              }
            />
            <InputNumber
              min={0}
              max={maxPriceValue}
              type="number"
              style={{ width: "100%" }}
              placeholder="Min Price"
              value={minPriceValue}
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
              max={propertyConstants.MAX_PRICE_VALUE}
              type="number"
              onChange={(value) => {
                handleChange("maxPriceValue", value);
              }}
              value={
                typeof maxPriceValue === "number"
                  ? maxPriceValue
                  : 0
              }
            />
            <InputNumber
              min={0}
              max={2000000}
              type="number"
              style={{ width: "100%" }}
              placeholder="Max Price"
              value={maxPriceValue}
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
              value={postalcode}
              style={{ width: "100%" }}
              placeholder="Enter Zipcode"
              controls={false}
              onChange={(value) => {
                handleChange("postalcode", value);
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
              value={stateOrProvince}
              onChange={(value) => {
                handleChange("stateOrProvince", value);
              }}
              options={states}
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
              onChange={(value) => {
                handleChange("bedroomsTotal", value);
              }}
              value={
                typeof bedroomsTotal === "number"
                  ? bedroomsTotal
                  : 0
              }
            />
            <InputNumber
              min={0}
              type="number"
              style={{ width: "100%" }}
              placeholder="Min Bedrooms"
              value={bedroomsTotal}
              controls={false}
              onChange={(value) => {
                handleChange("bedroomsTotal", value);
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
              onChange={(value) => {
                handleChange("bathroomsTotalInteger", value);
              }}
              value={
                typeof bathroomsTotalInteger === "number"
                  ? bathroomsTotalInteger
                  : 0
              }
            />
            <InputNumber
              min={0}
              type="number"
              style={{ width: "100%" }}
              placeholder="Min Bathrooms"
              value={bathroomsTotalInteger}
              controls={false}
              onChange={(value) => {
                handleChange("bathroomsTotalInteger", value);
              }}
              onWheel={(e) => e.target.blur()}
            />
          </Panel>

          <Panel style={{ fontWeight: 700 }} header="Amenities" key="4">
            <Checkbox.Group
              style={{ display: "grid", lineHeight: "30px" }}
              options={amenities}
              value={filterOption?.amenities}
              onChange={(value) => {
                handleChange("amenities", value);
              }}
            />
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
              value={lotSizeArea}
              controls={false}
              onChange={(value) => {
                handleChange("lotSizeArea", value);
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
              options={parkingType}
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
              options={propertyTypes}
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
