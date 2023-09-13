import React, { useEffect, useState } from "react";
import {
  Tabs,
  Table,
  Input,
  Select,
  Button,
  DatePicker,
  Space,
  InputNumber,
  Row,
  Col,
  Typography,
} from "antd";
import {
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  LockOutlined,
  CaretDownOutlined,
} from "@ant-design/icons";
import "./service.css";

const { TabPane } = Tabs;
const { Option } = Select;

const newRowSchema = {
  user: "",
  provider: "",
  membershipId: "",
  service: "",
  summary: "",
  date: null,
  comments: "",
  status: "",
  pricePaid: "",
  editable: true,
};

const boookedData = [
  {
    key: "1",
    user: "User 1",
    provider: "Provider 1",
    membershipId: "12345",
    service: "Service A",
    summary: "Summary 1",
    date: "2023-09-12",
    comments: "Comment 1",
    status: "Status 1",
    pricePaid: "100",
    editable: false,
  },
];

const provideData = [
  {
    key: "2",
    user: "User 2",
    provider: "Provider 2",
    membershipId: "67890",
    service: "Service B",
    summary: "Summary 2",
    date: "2023-09-13",
    comments: "Comment 2",
    status: "Status 2",
    pricePaid: "200",
    editable: false,
  },
];

const ServiceTable = () => {
  const [isEdit, setIsEdit] = useState(false);
  const [validationError, setValidationError] = useState(false);
  const [activeTab, setActiveTab] = useState("booked");
  const [tableData, setTableData] = useState(boookedData);

  useEffect(() => {
    if (activeTab === "booked") {
      setTableData(boookedData);
    } else {
      setTableData(provideData);
    }
  }, [activeTab])

  const handleTabChange = (key) => {
    setActiveTab(key);
  };

  const handleEdit = (key) => {
    setIsEdit(true);
    const item = tableData.find((item) => item.key === key);
    // make API call and setState
  };

  const handleCancel = (key) => {
    setIsEdit(false);
    // set initial state
    setTableData(tableData)
    // make API call and setState
  };

  const handleUpdate = (key) => {
    // const item = newData.find((item) => item.key === key);
    // make API call and setState
  };

  const handleInputChange = (e, field, key) => {
    // manage an temporary state for that row
  };

  const handleDateChange = (date, dateString, key) => {
    // it will go in the input change with a different check for date
  };

  const handleSelectChange = (value, field, key) => {
    // it will go in the input change with a different check for date
  };

  const handleAddRow = () => {
    // just add a new empty row in the tableData
  };

  const handleSave = () => {
    const data = tableData.map((item, index) => {
      item["editable"] = false;
      return item;
    });
    setTableData(data);
  };

  const handleValidation = (data) => {
    for (const key in data) {
      if (
        key !== "user" &&
        (data["provider"] === "" ||
          data["membershipId"] === "" ||
          data["service"] === "" ||
          data["summary"] === "" ||
          data["date"] === "" ||
          data["comments"] === "" ||
          data["status"] === "" ||
          data["pricePaid"] === "")
      ) {
        setValidationError(true);
        return false;
      } else if (
        data[key] === "provider" &&
        (data["user"] === "" ||
          data["membershipId"] === "" ||
          data["service"] === "" ||
          data["summary"] === "" ||
          data["date"] === "" ||
          data["comments"] === "" ||
          data["status"] === "" ||
          data["pricePaid"] === "")
      ) {
        setValidationError(true);
        return false;
      } else {
        setValidationError(false);
        return true;
      }
    }
  };

  const columns = [
    {
      title: "User",
      dataIndex: "user",
      key: "user",
      render: (text, record) => (
        <span>
          {record.editable && !isEdit ? (
            <Select
              placeholder="User"
              suffixIcon={
                activeTab === "booked" ? (
                  <LockOutlined />
                ) : (
                  <CaretDownOutlined />
                )
              }
              disabled={activeTab === "booked"}
              style={{ width: 120 }}
              onChange={(value) =>
                handleSelectChange(value, "user", record.key)
              }
              options={[
                { value: "jack", label: "Jack" },
                { value: "lucy", label: "Lucy" },
              ]}
            />
          ) : (
            <Typography style={{ color: "#061A6C" }}>
              {text}
              {/* {activeTab === "booked" && <LockOutlined />} */}
            </Typography>
          )}
        </span>
      ),
    },
    {
      title: "Provider",
      dataIndex: "provider",
      key: "provider",
      render: (text, record) => (
        <span>
          {record.editable && !isEdit ? (
            <Select
              placeholder="Provider"
              suffixIcon={
                activeTab === "provided" ? (
                  <LockOutlined />
                ) : (
                  <CaretDownOutlined />
                )
              }
              disabled={activeTab === "provided"}
              style={{ width: 120 }}
              onChange={(value) =>
                handleSelectChange(value, "provider", record.key)
              }
              options={[
                { value: "BOXR", label: "BOXR" },
                { value: "Eqinox", label: "Eqinox" },
              ]}
            />
          ) : (
            <span>
              {text}
              {/* {activeTab === "provided" && <LockOutlined />} */}
            </span>
          )}
        </span>
      ),
    },
    {
      title: "Membership ID",
      dataIndex: "membershipId",
      key: "membershipId",
      render: (text, record) => (
        <span>
          {record.editable && !isEdit ? (
            <Select
              placeholder="Membership ID"
              suffixIcon={<CaretDownOutlined />}
              style={{ width: 120 }}
              onChange={(value) =>
                handleSelectChange(value, "membershipId", record.key)
              }
              options={[
                { value: "AB1", label: "AB1" },
                { value: "BC2", label: "BC2" },
              ]}
            />
          ) : (
            <Typography style={{ color: "#061A6C" }}>{text}</Typography>
          )}
        </span>
      ),
    },
    {
      title: "Service",
      dataIndex: "service",
      key: "service",
      render: (text, record) => (
        <span>
          {record.editable && !isEdit ? (
            <Select
              placeholder="Service"
              suffixIcon={<CaretDownOutlined />}
              style={{ width: 120 }}
              onChange={(value) =>
                handleSelectChange(value, "service", record.key)
              }
              options={[
                { value: "crossfit", label: "crossfit" },
                { value: "personal training", label: "personal training" },
              ]}
            />
          ) : (
            <Typography style={{ color: "#061A6C" }}>{text}</Typography>
          )}
        </span>
      ),
    },
    {
      title: "Summary",
      dataIndex: "summary",
      key: "summary",
      render: (text, record) => (
        <span>
          {record.editable ? (
            <Input
              value={text}
              suffix={<EditOutlined />}
              placeholder="Summary"
              onChange={(e) =>
                handleInputChange(e.target.value, "summary", record.key)
              }
            />
          ) : (
            text
          )}
        </span>
      ),
    },
    {
      title: "Date",
      dataIndex: "date",
      key: "date",
      render: (text, record) => (
        <span>
          {record.editable && !isEdit ? (
            <DatePicker
              // value={text ? moment(text, 'YYYY-MM-DD') : null}
              onChange={(date, dateString) =>
                handleDateChange(date, dateString, record.key)
              }
            />
          ) : (
            <Typography style={{ color: "#061A6C" }}>{text}</Typography>
          )}
        </span>
      ),
    },
    {
      title: "Comments",
      dataIndex: "comments",
      key: "comments",
      render: (text, record) => (
        <span>
          {record.editable ? (
            <Input
              value={text}
              suffix={<EditOutlined />}
              placeholder="Comments"
              onChange={(e) =>
                handleInputChange(e.target.value, "comments", record.key)
              }
            />
          ) : (
            text
          )}
        </span>
      ),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (text, record) => (
        <span>
          {record.editable ? (
            <Select
              value={text}
              placeholder="Status"
              suffixIcon={<CaretDownOutlined />}
              // disabled={activeTab === "provided"}
              style={{ minWidth: "100px" }}
              onChange={(value) =>
                handleSelectChange(value, "status", record.key)
              }
            >
              <Option value="requested">Requested</Option>
              <Option value="Cancelled">Cancelled</Option>
            </Select>
          ) : (
            <Typography style={{ color: "#061A6C" }}>{text}</Typography>
          )}
        </span>
      ),
    },
    {
      title: "Price Paid",
      dataIndex: "pricePaid",
      key: "pricePaid",
      render: (text, record) => (
        <span>
          {record.editable && !isEdit ? (
            <InputNumber
              keyboard={true}
              className="w-36"
              addonAfter={<EditOutlined />}
              min={0}
              controls={false}
              value={text}
              placeholder="Price Paid"
              onChange={(e) => handleInputChange(e, "pricePaid", record.key)}
            />
          ) : (
            <Typography style={{ color: "#061A6C" }}>{text}</Typography>
          )}
        </span>
      ),
    },
    {
      title: "",
      dataIndex: "actions",
      key: "actions",
      render: (_, record) => (
        <Space size="middle">
          {record.editable ? (
            <>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                disabled={!handleValidation(record)}
                onClick={() => handleUpdate(record.key)}
              />
              {isEdit && (
                <Button
                  type="default"
                  icon={<CloseOutlined />}
                  onClick={() => handleCancel(record.key)}
                />
              )}
            </>
          ) : (
            <Button
              type="primary"
              icon={<EditOutlined />}
              onClick={() => handleEdit(record.key)}
            />
          )}
          {/* <Button type="danger" icon={<DeleteOutlined />} onClick={() => handleDelete(record.key)} /> */}
        </Space>
      ),
    },
  ];

  const handleChangeTab = (selectedTab) => {
    setActiveTab(selectedTab);
    if (selectedTab === "booked") {
      setTableData(boookedData);
    } else {
      setTableData(provideData);
    }
  }

  return (
    <>
      <Row className="mt-2">
        <Col span={22} className="m-auto">
          <Tabs activeKey={activeTab} onChange={handleTabChange}>
            <TabPane tab="Booked" key="booked"></TabPane>
            <TabPane tab="Provided" key="provided" onClick={() => {handleChangeTab('provided')}}></TabPane>
          </Tabs>
        </Col>
        <Col
          className="flex justify-between absolute right-20 mt-2 z-10"
          span={4}
        >
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAddRow}
            disabled={validationError}
          >
            Add Service Use
          </Button>
          <Button
            className="ml-2"
            style={{ backgroundColor: "green" }}
            type="primary"
            onClick={handleSave}
            disabled={validationError}
          >
            Save
          </Button>
        </Col>
      </Row>
      <Row>
        <Col span={18}>
          <Typography.Title level={4} style={{ color: "#061A6C" }}>
            Service Usage
          </Typography.Title>
        </Col>
        <Col span={6}>
          <span>
            <Select
              placeholder="Provider"
              suffixIcon={<CaretDownOutlined />}
              style={{ width: 120 }}
              options={[
                { value: "jack", label: "Jack" },
                { value: "lucy", label: "Lucy" },
              ]}
            />
            <Select
              placeholder="Status"
              className="ml-2"
              suffixIcon={<CaretDownOutlined />}
              style={{ width: 120 }}
              options={[
                { value: "requested", label: "Requested" },
                { value: "Cancelled", label: "Cancelled" },
              ]}
            />
          </span>
        </Col>
      </Row>
      <Table
        columns={columns}
        dataSource={tableData}
        pagination={false}
        rowKey="key"
      />
    </>
  );
};

export default ServiceTable;
