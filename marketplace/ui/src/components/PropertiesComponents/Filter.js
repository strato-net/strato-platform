import React, { useState } from 'react'
import filterData from "../../helpers/filterOptions.json"
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
import { FilterFilled } from "@ant-design/icons";
const { Panel } = Collapse;


const Filter = () => {

  const MAX_PRICE_VALUE = 2000000;
  const [propertiesFiltered, setPropertiesFiltered] = useState();
  const [inputZipcodeValue, setInputZipcodeValue] = useState();
  const [inputStateValue, setInputStateValue] = useState();

  const [inputMinPriceValue, setInputMinPriceValue] = useState(0);
  const [inputMaxPriceValue, setInputMaxPriceValue] = useState(MAX_PRICE_VALUE);
  const [inputMinBathrooms, setInputMinBathrooms] = useState(0);
  const [inputMinBedrooms, setInputMinBedrooms] = useState(0);
  const [inputMinSqFt, setInputMinSqFt] = useState(0);

  const [inputSortBy, setInputSortBy] = useState();

  const [inputHasYardChecked, setInputHasYardChecked] = useState(false);
  const [inputHasACChecked, setInputHasAChecked] = useState(false);
  const [inputHasPoolChecked, setInputHasPoolChecked] = useState(false);
  const [inputHasParkingChecked, setInputHasParkingChecked] = useState(false);
  const [inputPropertyType, setInputPropertyType] = useState();
  const [inputParkingType, setInputParkingType] = useState();

  // const { properties, isPropertiesLoading } = usePropertiesState();
  const [isDrawerOpen, setDrawerOpen] = useState(false); 

  const onChangeZipcodeValidation = (newValue) => {
    setInputZipcodeValue(newValue);
  };
  const onChangeState = (newValue) => {
    setInputStateValue(newValue);
  };

  const onChangeMinPrice = (newValue) => {
    setInputMinPriceValue(newValue);
  };
  const onChangeMaxPrice = (newValue) => {
    setInputMaxPriceValue(newValue);
  };
  const onChangeMinBathrooms = (newValue) => {
    setInputMinBathrooms(newValue);
  };
  const onChangeMinBedrooms = (newValue) => {
    setInputMinBedrooms(newValue);
  };
  const onChangeMinSqFt = (newValue) => {
    setInputMinSqFt(newValue);
  };
  const handleChangeSortBy = (value) => {
    setInputSortBy(value);
  };
  const onChangeYard = (value) => {
    setInputHasYardChecked(value.target.checked);
  };
  const onChangeAC = (value) => {
    setInputHasAChecked(value.target.checked);
  };
  const onChangePool = (value) => {
    setInputHasPoolChecked(value.target.checked);
  };
  const onChangeParking = (value) => {
    setInputHasParkingChecked(value.target.checked);
  };
  const onChangeParkingType = (value) => {
    setInputParkingType(value.target.checked)
  }
  const onChangeProperty = (value) => {
    setInputPropertyType(value.target.checked)
  }

  const openDrawer = () => {
    setDrawerOpen(true);
  };

  const closeDrawer = () => {
    setDrawerOpen(false);
  };


  return (
    <>
      <Drawer
        placement="left"
        size={"default"}
        onClose={closeDrawer}
        open={isDrawerOpen}
      >
        <Typography.Title level={5}>Sort By</Typography.Title>
        <Select
          value={inputSortBy}
          style={{ width: "100%" }}
          onChange={handleChangeSortBy}
          defaultValue={"Select"}
          options={[
            { value: "Select", label: "Select" },
            { value: "minPrice", label: "Sort By Lowest Price" },
            { value: "maxPrice", label: "Sort By Highest Price" },
            { value: "minSqFt", label: "Sort By Lowest Sq Ft." },
            { value: "maxSqFt", label: "Sort By Highest Sq Ft." },
          ]}
        />

        <Typography.Title level={5} style={{ marginTop: '15px' }}>Filter By</Typography.Title>
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
              max={2000000}
              onChange={onChangeMinPrice}
              value={
                typeof inputMinPriceValue === "number" ? inputMinPriceValue : 0
              }
            />
            <InputNumber
              min={0}
              max={2000000}
              style={{ width: "100%" }}
              placeholder="input min price"
              value={inputMinPriceValue}
              onChange={onChangeMinPrice}
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
              onChange={onChangeMaxPrice}
              value={
                typeof inputMaxPriceValue === "number" ? inputMaxPriceValue : 0
              }
            />
            <InputNumber
              min={0}
              max={2000000}
              style={{ width: "100%" }}
              placeholder="input max price"
              value={inputMaxPriceValue}
              onChange={onChangeMaxPrice}
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
              value={inputZipcodeValue}
              style={{ width: "100%" }}
              placeholder="Input a Zipcode"
              onChange={onChangeZipcodeValidation}
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
              value={inputStateValue}
              onChange={onChangeState}
              defaultValue={"Select"}
              options={filterData?.States}
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
              onChange={onChangeMinBedrooms}
              value={
                typeof inputMinBedrooms === "number" ? inputMinBedrooms : 0
              }
            />
            <InputNumber
              min={0}
              max={7}
              style={{ width: "100%" }}
              placeholder="input min bedrooms"
              value={inputMinBedrooms}
              onChange={onChangeMinBedrooms}
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
              onChange={onChangeMinBathrooms}
              value={
                typeof inputMinBathrooms === "number" ? inputMinBathrooms : 0
              }
            />
            <InputNumber
              min={0}
              max={7}
              style={{ width: "100%" }}
              placeholder="input min bathrooms"
              value={inputMinBathrooms}
              onChange={onChangeMinBathrooms}
            />
          </Panel>

          <Panel style={{ fontWeight: 700 }} header="Amenities" key="4">
            <div style={{ display: "flex", flexDirection: "column" }}>
              <Checkbox checked={inputHasYardChecked} onChange={onChangeYard}>
                Yard
              </Checkbox>
              <Checkbox
                checked={inputHasACChecked}
                style={{ marginLeft: 0 }}
                onChange={onChangeAC}
              >
                AC
              </Checkbox>
              <Checkbox
                checked={inputHasPoolChecked}
                style={{ marginLeft: 0 }}
                onChange={onChangePool}
              >
                Pool
              </Checkbox>
              <Checkbox
                checked={inputHasParkingChecked}
                style={{ marginLeft: 0 }}
                onChange={onChangeParking}
              >
                Parking
              </Checkbox>
            </div>
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
              style={{ width: "100%" }}
              placeholder="input min sq ft."
              value={inputMinSqFt}
              onChange={onChangeMinSqFt}
            />
          </Panel>
          <Panel style={{ fontWeight: 700 }} header="Property & Parking" key="6">
            <Typography.Title
              level={5}
              style={{ marginTop: 5 }}
              ellipsis={{ tooltip: true }}
            >
              Parking
            </Typography.Title>
            <Select
              style={{ width: "100%" }}
              value={inputStateValue}
              onChange={onChangeParkingType}
              defaultValue={"Select"}
              options={filterData?.ParkingType}
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
              value={inputStateValue}
              onChange={onChangeProperty}
              defaultValue={"Select"}
              options={filterData?.PropertyTypes}
            />
          </Panel>
        </Collapse>
      </Drawer>


      <Row>
        <Col span={1}></Col>
        <Col span={22}>
          <Typography.Title
            level={4}
            style={{ margin: "0px 18px" }}
          >
            {/* Properties for you */}
            <Space style={{ marginLeft: "15px" }}>
              <Button icon={<FilterFilled />} onClick={openDrawer}>Filter</Button>
            </Space>
          </Typography.Title>
        </Col>
        <Col span={1}></Col>
      </Row>
    </>
  )
}

export default Filter