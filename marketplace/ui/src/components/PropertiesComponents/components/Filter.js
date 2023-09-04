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
import { categoriesObj, homeTypeData } from "../helpers/constants";

const { Panel } = Collapse;

const Filter = (props) => {
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const { filterOption } = props;

  const { sortBy, states, amenities } = filterData;
  const { parking_features } = categoriesObj
  const { sort_By, min_Price, max_Price, zip_code, parking_Type, property_Type, state, min_Bedrooms, min_Bathrooms, lot_Size_Area, } = filterOption;

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
    setDrawerOpen(false);
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
          value={sort_By}
          className='w-full'
          placeholder="Sort By"
          onChange={(value) => {
            handleChange("sort_By", value);
          }}
          options={sortBy}
        />

        <Typography.Title level={5} className="mt-3.5">
          Filter By
        </Typography.Title>
        <Collapse
          expandIconPosition={"end"}
          defaultActiveKey={["1", "2"]}
        >
          <Panel className="font-bold" header="Price Range" key="1">
            <Typography.Title
              level={5}
              className="mt-0"
              ellipsis={{ tooltip: true }}
            >
              Min Price
            </Typography.Title>
            <InputNumber
              min={0}
              max={max_Price}
              type="number"
              className='w-full'
              placeholder="Min Price"
              value={min_Price}
              controls={false}
              onChange={(value) => {
                handleChange("min_Price", value);
              }}
              onWheel={(e) => e.target.blur()}
            />
            <Typography.Title
              level={5}
              className='mt-1'
              ellipsis={{ tooltip: true }}
            >
              Max Price
            </Typography.Title>
            <InputNumber
              min={0}
              type="number"
              className='w-full'
              placeholder="Max Price"
              value={max_Price}
              controls={false}
              onChange={(value) => {
                handleChange("max_Price", value);
              }}
              onWheel={(e) => e.target.blur()}
            />
          </Panel>
          <Panel className="font-bold" header="Location" key="2">
            <Typography.Title
              level={5}
              className="mt-0"
              ellipsis={{ tooltip: true }}
            >
              Zip Code
            </Typography.Title>
            <InputNumber
              min={0}
              max={99999}
              type="number"
              value={zip_code}
              className='w-full'
              placeholder="Enter Zipcode"
              controls={false}
              onChange={(value) => {
                handleChange("zip_code", value);
              }}
              onWheel={(e) => e.target.blur()}
            />
            <Typography.Title
              level={5}
              className='mt-1'
              ellipsis={{ tooltip: true }}
            >
              State
            </Typography.Title>
            <Select
              className='w-full'
              placeholder="State"
              value={state}
              onChange={(value) => {
                handleChange("state", value);
              }}
              options={states}
            />
          </Panel>

          <Panel
            className="font-bold"
            header="Bedrooms & Bathrooms"
            key="3"
          >
            <Typography.Title
              level={5}
              className="mt-0"
              ellipsis={{ tooltip: true }}
            >
              Min Bedrooms
            </Typography.Title>
            <Slider
              step={1}
              min={0}
              onChange={(value) => {
                handleChange("min_Bedrooms", value);
              }}
              value={
                typeof min_Bedrooms === "number"
                  ? min_Bedrooms
                  : 0
              }
            />
            <InputNumber
              min={0}
              type="number"
              className='w-full'
              placeholder="Min Bedrooms"
              value={min_Bedrooms}
              controls={false}
              onChange={(value) => {
                handleChange("min_Bedrooms", value);
              }}
              onWheel={(e) => e.target.blur()}
            />
            <Typography.Title
              level={5}
              className="mt-0"
              ellipsis={{ tooltip: true }}
            >
              Min Bathrooms
            </Typography.Title>
            <Slider
              step={1}
              min={0}
              onChange={(value) => {
                handleChange("min_Bathrooms", value);
              }}
              value={
                typeof min_Bathrooms === "number"
                  ? min_Bathrooms
                  : 0
              }
            />
            <InputNumber
              min={0}
              type="number"
              className='w-full'
              placeholder="Min Bathrooms"
              value={min_Bathrooms}
              controls={false}
              onChange={(value) => {
                handleChange("min_Bathrooms", value);
              }}
              onWheel={(e) => e.target.blur()}
            />
          </Panel>

          <Panel className="font-bold" header="Amenities" key="4">
            <Checkbox.Group
              className="grid leading-7"
              options={amenities}
              value={filterOption?.amenities}
              onChange={(value) => {
                handleChange("amenities", value);
              }}
            />
          </Panel>

          <Panel className="font-bold" header="Sq. Footage" key="5">
            <Typography.Title
              level={5}
              className="mt-0"
              ellipsis={{ tooltip: true }}
            >
              Min Sq Ft.
            </Typography.Title>
            <InputNumber
              min={0}
              type="number"
              className='w-full'
              placeholder="Min Sq Ft."
              value={lot_Size_Area}
              controls={false}
              onChange={(value) => {
                handleChange("lot_Size_Area", value);
              }}
              onWheel={(e) => e.target.blur()}
            />
          </Panel>
          <Panel
            className="font-bold"
            header="Property & Parking"
            key="6"
          >
            <Typography.Title
              level={5}
              className='mt-1'
              ellipsis={{ tooltip: true }}
            >
              Parking
            </Typography.Title>
            <Select
              className='w-full'
              placeholder="Parking Type"
              value={parking_Type}
              onChange={(value) => {
                handleChange("parking_Type", value);
              }}
              options={parking_features}
            />

            <Typography.Title
              level={5}
              className='mt-1'
              ellipsis={{ tooltip: true }}
            >
              Property
            </Typography.Title>
            <Select
              className='w-full'
              placeholder="Property Type"
              value={property_Type}
              onChange={(value) => {
                handleChange("property_Type", value);
              }}
              options={homeTypeData}
            />
          </Panel>
        </Collapse>
      </Drawer>

      <Row>
        <Col span={1}></Col>
        <Col span={22}>
          <Typography.Title level={4} className="my-0 mx-5">
            {/* Properties for you */}
            <Space className="mt-3.5">
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
