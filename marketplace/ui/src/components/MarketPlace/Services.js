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
import { actions as serviceUsageActions } from "../../contexts/serviceUsage/actions";
import { actions as servicesActions } from "../../contexts/service/actions"
import { actions as userAuthActions } from "../../contexts/users/actions"
import { useServiceUsageDispatch } from "../../contexts/serviceUsage";
import { useAuthenticateDispatch, useAuthenticateState } from "../../contexts/authentication";
import { useMembershipState } from "../../contexts/membership";
import { useServiceDispatch, useServiceState } from "../../contexts/service";

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
const limit = 10;
const offset = 0;
const query = {};

const ServiceTable = () => {
  const serviceUsageDispatch = useServiceUsageDispatch();
  const serviceDispatch = useServiceDispatch();
  const authUserDispatch = useAuthenticateDispatch();

  // all api call states
  const userCert = useAuthenticateState();
  const services = useServiceState();
  const membership = useMembershipState();


  const [isEdit, setIsEdit] = useState(false);
  const [validationError, setValidationError] = useState(false);
  const [activeTab, setActiveTab] = useState("booked");
  const [tableData, setTableData] = useState(boookedData);
  const [editIcon, setEditIcon] = useState(false)
  // const Username =  userCert?.user?.commonName;

  useEffect(() => {
    serviceUsageActions.fetchAllServicesUsage(serviceUsageDispatch, limit, offset, query)
    servicesActions.fetchService(serviceDispatch, limit, offset, query)
    // userAuthActions.fetchUsers(authUserDispatch)

  }, [])

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

  const handleEditCancel = (key, bool, type) => {
    setIsEdit(bool);
    const data = tableData.filter((item, index) => {
      if (item.key === key) {
        item['editable'] = bool;
        return item;
      } else if (type === 'edit') {
        item['editable'] = false;
        return item;
      } return item;

    });
    setTableData(data)
    if (type === 'update') {
      // uncomment api call for updating service usage
      // serviceUsageActions.UpdateServiceUsage(serviceUsage, tableData)
    }
  };

  const handleInputChange = (value, field, key) => {
    let data = tableData.filter((item, index) => {
      if (item.key === key) {
        item[field] = value
        return item;
      } return item;
    })
    setTableData(data)
  };

  const handleAddRow = () => {
    // just add a new empty row in the tableData
    setIsEdit(false);
    let tableCopy = tableData.map((item, index) => {
      item['editable'] = false;
      return item;
    })
    let data = { ...newRowSchema }
    data['key'] = tableCopy.length + 1;
    setTableData([...tableCopy, data])
  };

  const handleSave = () => {
    const data = tableData.map((item, index) => {
      item["editable"] = false;
      return item;
    });
    setTableData(data);
    // uncomment api call for creating service usage
    // serviceUsageActions.createServiceUsage(serviceUsage, tableData)
  };

  const handleDelete = (key) => {
    let data = tableData.filter(item => item.key !== key)
    setTableData(data)
  }

  const handleValidation = (data) => {
    const requiredFields = ["membershipId", "service", "summary", "date", "comments", "status", "pricePaid",];

    if (activeTab === "booked" || activeTab === "provided") {
      // const requiredField = activeTab === "booked" ? "provider" : "user";
      if (requiredFields.every((field) => data[field] !== "")) {
        setValidationError(false);
        return true;
      }
    }
    setValidationError(true);
    return false;
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
                handleInputChange(value, "user", record.key)
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
                handleInputChange(value, "provider", record.key)
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
                handleInputChange(value, "membershipId", record.key)
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
                handleInputChange(value, "service", record.key)
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
                handleInputChange(dateString, 'date', record.key)
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
                handleInputChange(value, "status", record.key)
              }
            >
              <Option value="requested">Requested</Option>
              <Option value="cancelled">Cancelled</Option>
              <Option value="completed">Completed</Option>
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
                onClick={() => handleEditCancel(record.key, false, "update")}
              />
              {isEdit && (
                <Button
                  type="default"
                  icon={<CloseOutlined />}
                  onClick={() => handleEditCancel(record.key, false, "cancel")}
                />
              )}
            </>
          ) : (
            <Button
              type="primary"
              icon={<EditOutlined />}
              disabled={!handleValidation(record) || validationError}
              onClick={() => handleEditCancel(record.key, true, "edit")}
            />
          )}
          {record.editable && !isEdit && <Button type="danger" icon={<DeleteOutlined />} onClick={() => handleDelete(record.key)} />}
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
            <TabPane tab="Provided" key="provided" onClick={() => { handleChangeTab('provided') }}></TabPane>
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
        <Col span={22} className="m-auto flex justify-between">
          <Typography.Title level={4} style={{ color: "#061A6C" }}>
            Service Usage
          </Typography.Title>
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
                { value: "cancelled", label: "Cancelled" },
                { value: "completed", label: "Completed" },
              ]}
            />
          </span>
        </Col>
      </Row>
      <Row>
        <Col span={22} className="m-auto">
          <Table
            columns={columns}
            dataSource={tableData}
            pagination={false}
            rowKey="key"
          />
        </Col>
      </Row>
    </>
  );
};

export default ServiceTable;
