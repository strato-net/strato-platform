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
  Spin,
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
import { actions as userAuthActions } from "../../contexts/authentication/actions"
import { actions as membershipActions } from "../../contexts/membership/actions"
import { useServiceUsageDispatch, useServiceUsageState } from "../../contexts/serviceUsage";
import { useAuthenticateDispatch, useAuthenticateState } from "../../contexts/authentication";
import { useMembershipDispatch, useMembershipState } from "../../contexts/membership";
import { useServiceDispatch, useServiceState } from "../../contexts/service";
import { useUsersState } from "../../contexts/users";


const statusOptions = [
  { value: 0, label: "Requested" },
  { value: 1, label: "Cancelled" },
  { value: 2, label: "Completed" },
]

// const providerOptions = 
// const userOptions = 

const limit = 10;
const offset = 0;
const query = {};

const ServiceTable = () => {
  const serviceUsageDispatch = useServiceUsageDispatch();
  const serviceDispatch = useServiceDispatch();
  const authUserDispatch = useAuthenticateDispatch();
  const membershipDispatch = useMembershipDispatch()


  // all api call states
  const userCert = useAuthenticateState();
  // const userListState = useUsersState();
  const servicesState = useServiceState();
  const membership = useMembershipState();
  const serviceUsageState = useServiceUsageState();

  const { isUsersLoading } = userCert;
  const { isservicesLoading } = servicesState;
  const { isPurchasedMembershipLoading } = membership;
  const { isServicesUsageLoading } = serviceUsageState;
  const checkIsLoading = (isservicesLoading || isPurchasedMembershipLoading || isServicesUsageLoading || isUsersLoading);
  const providerData = membership?.purchasedMemberships.map((item, index) => {
    return { value: item.itemNumber, label: item.manufacturer }
  })
  const [providerList, setProviderList] = useState(providerData)

  const serviceListData = servicesState?.services?.map((item, index) => {
    return { value: item.address, label: item.name }
  })
  const [serviceList, setServiceList] = useState(serviceListData);
  const [userList, setUserList] = useState([])

  const userListData = userCert?.users?.map((item, index) => {
    return { value: item.userAddress, label: item.commonName }
  })


  useEffect(() => {
    setServiceList(serviceListData)
    setProviderList(providerData)
    setTableData(serviceUsageState?.servicesUsage)
    setUserList(userListData)
  }, [servicesState, membership, serviceUsageState, userCert])


  const [isEdit, setIsEdit] = useState(false);
  const [validationError, setValidationError] = useState(false);
  const [activeTab, setActiveTab] = useState("booked");
  const [tableData, setTableData] = useState([]);
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(20)
  const [filterQuery, setFilterQuery] = useState({})
  const Username = userCert?.user?.commonName;
  const organization = userCert?.user?.organization;

  const newRowSchema = {
    summary: '', //summary
    serviceDate: '', //Date
    providerComment: '', //comment
    status: 1,
    pricePaid: '', //price paid
    editable: true,
    itemId: '', //provider
    serviceId: '', //service
    paymentStatus: 1,

    providerLastUpdated: userCert?.user?.userAddress, //user-address
    providerLastUpdatedDate: new Date().getTime().toString(),
  };

  useEffect(() => {
    serviceUsageActions.fetchAllServicesUsage(serviceUsageDispatch, 30, offset, query)
    servicesActions.fetchService(serviceDispatch, limit, offset, query)
    membershipActions.fetchPurchasedMemberships(membershipDispatch);
    userAuthActions.fetchUsers(authUserDispatch)
  }, [activeTab])

  const handleTabChange = (key) => {
    setFilterQuery({})
    setPage(0)
    setActiveTab(key);
  };

  const userOptions = [
    { value: "jack", label: "Jack-user" },
    { value: "lucy", label: "Lucy-user" },
  ]

  const handleEditCancel = (key, bool, type, record) => {
    // handling 3 functionality (i.e, edit, update & cancel) using its type

    const UpdatePayloadKeys = ['serviceDate', 'summary', 'status', 'paymentStatus', 'providerLastUpdated',
      'providerComment', 'providerLastUpdatedDate', 'pricePaid']
    let updatedDataObj = {}
    UpdatePayloadKeys.forEach((item, index) => {
      if (['serviceDate', 'providerLastUpdatedDate', 'pricePaid'].includes(item)) {
        updatedDataObj[item] = record[item].toString()
      } else {
        updatedDataObj[item] = record[item]
      }
    })

    let updatedPayload = {};
    updatedPayload['address'] = record.address;
    updatedPayload['updates'] = updatedDataObj;

    setIsEdit(bool);
    const data = tableData.filter((item, index) => {
      if (index === key) {
        item['editable'] = bool;
        return item;
      } else if (type === 'edit') {
        item['editable'] = false;
        return item;
      } return item;

    });
    setTableData(data)
    if (type === 'update') {
      if (isEdit) {
        // we have to use update api here
        // uncomment api call for updating service usage
        serviceUsageActions.UpdateServiceUsage(serviceUsageDispatch, updatedPayload)
      } else {
        // we have to use create api here
        updatedDataObj['itemId'] = record['itemId'];
        updatedDataObj['serviceId'] = record['serviceId'];
        serviceUsageActions.createServiceUsage(serviceUsageDispatch, updatedDataObj)
      }
    };
  }

  const handleInputChange = (value, field, key) => {

    let data = tableData.filter((item, index) => {
      if (index === key) {
        item[field] = value ? value : ""
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
      // item["editable"] = false;
      delete item["editable"];
      delete item["key"];
      return item;
    });
    setTableData(data);
    if (isEdit) {
      // we have to use update api here
      // uncomment api call for updating service usage
      serviceUsageActions.UpdateServiceUsage(serviceUsageDispatch, data)
    } else {
      // we have to use create api here
      serviceUsageActions.createServiceUsage(serviceUsageDispatch, data.at(-1))
    }
  };

  const handleDelete = (key) => {
    let data = tableData.filter((item, index) => index !== key)
    setTableData(data)
  }

  const handleValidation = (data) => {
    const requiredFields = ['summary', 'serviceDate', 'providerComment', 'status', 'pricePaid',
      'serviceId', 'paymentStatus', 'providerLastUpdated', 'providerLastUpdatedDate',];

    if (activeTab === "booked" || activeTab === "provided") {
      if (requiredFields.every((field) => data[field] !== "")) {
        setValidationError(false);
        return true;
      }
    }
    setValidationError(true);
    return false;
  };

  const handleFilter = (value, key) => {
    let data = { ...filterQuery }
    data[key] = value;
    setFilterQuery(data)
  }

  const columns = [
    {
      title: "User",
      dataIndex: "providerLastUpdated",
      key: "providerLastUpdated",
      render: (text, record, index) => (
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
                handleInputChange(value, "providerLastUpdated", index)
              }
              options={userList}
            />
          ) : (
            <Typography style={{ color: "#061A6C" }}>
              {userList.reduce((label, item) => {
                if (item.value === text) {
                  return item.label;
                }
                return label;
              }, null)}
            </Typography>
          )}
        </span>
      ),
    },
    {
      title: "Provider",
      dataIndex: "itemId",
      key: "itemId",
      render: (text, record, index) => (
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
              onChange={(value, obj) => {
                handleInputChange(value.toString(), "itemId", index)
              }}
              options={providerList}
            />
          ) : (
            <span>
              {providerList.reduce((label, item) => {
                if (item.value === text) {
                  return item.label;
                }
                return label;
              }, null)}
            </span>
          )}
        </span>
      ),
    },
    {
      title: "Membership ID",
      dataIndex: "membershipId",
      key: "membershipId",
      render: (text, record, index) => (
        <span>
          {record.editable && !isEdit ? (
            <Select
              placeholder="Membership ID"
              suffixIcon={<CaretDownOutlined />}
              style={{ width: 120 }}
              onChange={(value) =>
                handleInputChange(value, "membershipId", index)
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
      dataIndex: "serviceId",
      key: "serviceId",
      render: (text, record, index) => (
        <span>
          {record.editable && !isEdit ? (
            <Select
              placeholder="Service"
              suffixIcon={<CaretDownOutlined />}
              style={{ width: 120 }}
              onChange={(value) =>
                handleInputChange(value, "serviceId", index)
              }
              options={serviceList}
            />
          ) : (
            <Typography style={{ color: "#061A6C" }}>{serviceList.reduce((label, item) => {
              if (item.value === text) {
                return item.label;
              }
              return label;
            }, null)}</Typography>
          )}
        </span>
      ),
    },
    {
      title: "Summary",
      dataIndex: "summary",
      key: "summary",
      render: (text, record, index) => (
        <span>
          {record.editable ? (
            <Input
              value={text}
              suffix={<EditOutlined />}
              placeholder="Summary"
              onChange={(e) =>
                handleInputChange(e.target.value, "summary", index)
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
      dataIndex: "serviceDate",
      key: "serviceDate",
      render: (text, record, index) => (
        <span>
          {record.editable && !isEdit ? (
            <DatePicker
              // value={text ? moment(text, 'YYYY-MM-DD') : null}
              onChange={(serviceDate, dateString) =>
                handleInputChange(new Date(serviceDate).getTime().toString(), 'serviceDate', index)
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
      dataIndex: "providerComment",
      key: "providerComment",
      render: (text, record, index) => (
        <span>
          {record.editable ? (
            <Input
              value={text}
              suffix={<EditOutlined />}
              placeholder="Comments"
              onChange={(e) =>
                handleInputChange(e.target.value, "providerComment", index)
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
      render: (text, record, index) => (
        <span>
          {record.editable ? (
            <Select
              value={text}
              placeholder="Status"
              suffixIcon={<CaretDownOutlined />}
              // disabled={activeTab === "provided"}
              style={{ minWidth: "100px" }}
              onChange={(value) =>
                handleInputChange(value, "status", index)
              }
              options={statusOptions}
            />
          ) : (
            <Typography style={{ color: "#061A6C" }}>{statusOptions.reduce((label, item) => {
              if (item.value === text) {
                return item.label;
              }
              return label;
            }, null)}</Typography>
          )}
        </span>
      ),
    },
    {
      title: "Price Paid",
      dataIndex: "pricePaid",
      key: "pricePaid",
      render: (text, record, index) => (
        <span>
          {record.editable && !isEdit ? (
            <InputNumber
              keyboard={true}
              className="w-36"
              addonAfter={<EditOutlined />}
              min={0}
              controls={false}
              value={parseInt(text)}
              placeholder="Price Paid"
              onChange={(value) => handleInputChange(value.toString(), "pricePaid", index)}
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
      render: (_, record, index) => (
        <Space size="middle">
          {record.editable ? (
            <>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                disabled={!handleValidation(record)}
                onClick={() => handleEditCancel(index, false, "update", record)}
              />
              {isEdit && (
                <Button
                  type="default"
                  icon={<CloseOutlined />}
                  onClick={() => handleEditCancel(index, false, "cancel", record)}
                />
              )}
            </>
          ) : (
            <Button
              type="primary"
              icon={<EditOutlined />}
              disabled={!handleValidation(record) || validationError}
              onClick={() => handleEditCancel(index, true, "edit", record)}
            />
          )}
          {record.editable && !isEdit && <Button type="danger" icon={<DeleteOutlined />} onClick={() => handleDelete(index)} />}
        </Space>
      ),
    },
  ];

  const tabOptions = [
    {
      key: 'booked',
      label: 'Booked',
    },
    {
      key: 'provided',
      label: 'Provided',
    },
  ]

  const activeTabCheck = activeTab === 'booked' ? 'Provider' : 'User';

  return (
    checkIsLoading
      ?
      <div className="h-96 flex justify-center items-center">
        <Spin size="large" spinning={checkIsLoading} />
      </div>
      :
      <>
        <Row className="mt-2">
          <Col span={22} className="m-auto">
            <Tabs activeKey={activeTab} items={tabOptions} onChange={handleTabChange} />
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
            <span className="service-filter">
              <Select
                placeholder={activeTabCheck}
                suffixIcon={<CaretDownOutlined />}
                style={{ width: 120 }}
                value={filterQuery[activeTabCheck]}
                onChange={(value) => { handleFilter(value, activeTabCheck) }}
                options={activeTab === 'booked' ? providerList : userOptions}
              />
              <Select
                placeholder="Status"
                className="ml-2"
                suffixIcon={<CaretDownOutlined />}
                style={{ width: 120 }}
                value={filterQuery['status']}
                onChange={(value) => { handleFilter(value, 'status') }}
                options={statusOptions}
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
