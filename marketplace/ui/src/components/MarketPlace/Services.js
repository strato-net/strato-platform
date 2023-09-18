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
  LockOutlined,
  CaretDownOutlined,
} from "@ant-design/icons";
import "./service.css";
import { actions as serviceUsageActions } from "../../contexts/serviceUsage/actions";
import { actions as servicesActions } from "../../contexts/service/actions";
import { actions as userAuthActions } from "../../contexts/authentication/actions";
import { actions as membershipActions } from "../../contexts/membership/actions";
import {
  useServiceUsageDispatch,
  useServiceUsageState,
} from "../../contexts/serviceUsage";
import {
  useAuthenticateDispatch,
  useAuthenticateState,
} from "../../contexts/authentication";
import {
  useMembershipDispatch,
  useMembershipState,
} from "../../contexts/membership";
import { useServiceDispatch, useServiceState } from "../../contexts/service";
import moment from "moment";

const statusOptions = [
  { value: 1, label: "Requested" },
  { value: 2, label: "Cancelled" },
  { value: 3, label: "Completed" },
];

const limit = 10;
const offset = 0;
const query = '';

const ServiceTable = () => {
  const serviceUsageDispatch = useServiceUsageDispatch();
  const serviceDispatch = useServiceDispatch();
  const authUserDispatch = useAuthenticateDispatch();
  const membershipDispatch = useMembershipDispatch();

  // all api call states
  const userCert = useAuthenticateState();
  // const userListState = useUsersState();
  const servicesState = useServiceState();
  const membership = useMembershipState();
  const serviceUsageState = useServiceUsageState();

  const { isUsersLoading } = userCert;
  const { isServicesLoading } = servicesState;
  const { isPurchasedMembershipLoading } = membership;
  const { isServicesUsageLoading, isCreateServiceUsageSubmitting, isUpdateServicesUsageLoading } = serviceUsageState;
  const IsLoading =
    isServicesLoading ||
    isPurchasedMembershipLoading ||
    isServicesUsageLoading ||
    isUsersLoading ||
    isCreateServiceUsageSubmitting;

  function transformData(data) {
    const uniqueProducts = {};
    const resultArray = [];

    data.forEach((item) => {
      const productId = item.productId;
      const manufacturer = item.manufacturer;

      // Check if the product ID is not already in the uniqueProducts object
      if (!uniqueProducts[productId]) {
        uniqueProducts[productId] = true; // Mark this product ID as seen
        resultArray.push({ value: productId, label: manufacturer });
      }
    });

    return resultArray;
  }

  const serviceUsageData = serviceUsageState?.servicesUsage?.map((item, index) => {
    const productId = membership?.purchasedMemberships.find(item1 => item1?.itemAddress === item?.itemId) ?? '';
    return { ...item, provider: productId['productId'] ? productId['productId'] : '' }
  })

  const providerData = membership?.purchasedMemberships.map((item, index) => {
    return { value: item.productId, label: item.manufacturer };
  })
  const providerFilter = membership?.purchasedMemberships.map((item, index) => {
    return { value: item.productId, label: item.manufacturer };
  })
  const defaultMembership = membership?.purchasedMemberships.map((item, index) => {
    return { value: item.itemAddress, label: item.itemNumber };
  })
  const serviceListData = servicesState?.services?.map((item, index) => {
    return { value: item.address, label: item.name };
  });
  const userListData = userCert?.users?.map((item, index) => {
    return { value: item.userAddress, label: item.commonName };
  });

  const [providerList, setProviderList] = useState(providerData);
  const [providerFilterList, setProviderFilterList] = useState(providerFilter);
  const [membershipList, setMembershipList] = useState(defaultMembership);
  const [serviceList, setServiceList] = useState(serviceListData);
  const [userList, setUserList] = useState(userListData);


  useEffect(() => {
    setServiceList(serviceListData);
  }, [servicesState]);

  useEffect(() => {
    setProviderList(providerData);
    setMembershipList(defaultMembership)
    // setProviderFilterList(providerFilter)
  }, [membership]);

  useEffect(() => {
    setTableData(serviceUsageData);
  }, [serviceUsageState]);

  useEffect(() => {
    setUserList(userListData);
  }, [userCert]);

  const [isEdit, setIsEdit] = useState(false);
  const [validationError, setValidationError] = useState(false);
  const [activeTab, setActiveTab] = useState("booked");
  const [tableData, setTableData] = useState([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(20);
  const [filterQuery, setFilterQuery] = useState({});
  const username = userCert?.user?.commonName;
  const organization = userCert?.user?.organization;

  const newRowSchema = {
    summary: "", //summary
    serviceDate: "", //Date
    providerComment: "", //comment
    status: 1,
    pricePaid: "", //price paid
    editable: true,
    itemId: "", //provider
    serviceId: "", //service
    paymentStatus: 1,

    providerLastUpdated: userCert?.user?.userAddress, //user-address
    providerLastUpdatedDate: new Date().getTime().toString(),
  };

  useEffect(() => {
    serviceUsageActions.fetchAllServicesUsage(serviceUsageDispatch, limit, offset, query);
    servicesActions.fetchService(serviceDispatch, '', offset, query);
    membershipActions.fetchPurchasedMemberships(membershipDispatch);
    userAuthActions.fetchUsers(authUserDispatch);
  }, [activeTab]);

  const handleTabChange = (key) => {
    setFilterQuery({});
    setPage(0);
    setActiveTab(key);
  };

  const userOptions = [
    { value: "jack", label: "Jack-user" },
    { value: "lucy", label: "Lucy-user" },
  ];

  const handleEditCancel = (key, bool, type, record) => {
    // handling 3 functionality (i.e, edit, update & cancel) using its type

    const UpdatePayloadKeys = [
      "serviceDate",
      "summary",
      "status",
      "paymentStatus",
      "providerLastUpdated",
      "providerComment",
      "providerLastUpdatedDate",
      "pricePaid",
    ];
    let updatedDataObj = {};
    UpdatePayloadKeys.forEach((item, index) => {
      if (
        ["serviceDate", "providerLastUpdatedDate", "pricePaid"].includes(item)
      ) {
        updatedDataObj[item] = record[item].toString();
      } else {
        updatedDataObj[item] = record[item];
      }
    });

    let updatedPayload = {};
    updatedPayload["address"] = record.address;
    updatedPayload["updates"] = updatedDataObj;

    setIsEdit(bool);
    const data = tableData.filter((item, index) => {
      if (index === key) {
        item["editable"] = bool;
        return item;
      } else if (type === "edit") {
        item["editable"] = false;
        return item;
      }
      return item;
    });
    setTableData(data);
    if (type === "update") {
      if (isEdit) {
        // we have to use update api here
        // uncomment api call for updating service usage
        serviceUsageActions.UpdateServiceUsage(serviceUsageDispatch, updatedPayload);
      } else {
        // we have to use create api here
        updatedDataObj["itemId"] = record["itemId"];
        updatedDataObj["serviceId"] = record["serviceId"];
        serviceUsageActions.createServiceUsage(serviceUsageDispatch, updatedDataObj);
      }
    }
  };

  const handleInputChange = (value, field, key) => {
    if (field === "provider") {
      let membershipData = membership?.purchasedMemberships.filter(({ productId }) => {
        return productId === value;
      }).map(({ itemAddress, itemNumber }) => {
        return { value: itemAddress, label: itemNumber };
      });
      setMembershipList(membershipData);
    }
    let data = tableData.filter((item, index) => {
      if (index === key) {
        item[field] = value ? value : "";
        return item;
      }
      return item;
    });
    setTableData(data);
  };

  const handleAddRow = () => {
    // just add a new empty row in the tableData
    setIsEdit(false);
    let tableCopy = tableData.map((item, index) => {
      item["editable"] = false;
      return item;
    });
    let data = { ...newRowSchema };
    data["key"] = tableCopy.length + 1;
    setTableData([data, ...tableCopy]);
  };

  const handleSave = () => {
    const data = tableData.map((item, index) => {
      delete item["editable"];
      delete item["key"];
      delete item['provider'];
      return item;
    });
    if (isEdit) {
      serviceUsageActions.UpdateServiceUsage(serviceUsageDispatch, data);
    } else {
      serviceUsageActions.createServiceUsage(serviceUsageDispatch, data.at(0));
    }
  };

  const handleDelete = (key) => {
    let data = tableData.filter((item, index) => index !== key);
    setTableData(data);
  };

  const handleValidation = (data) => {
    const requiredFields = [
      "summary",
      "serviceDate",
      "providerComment",
      "status",
      "pricePaid",
      "serviceId",
      "paymentStatus",
      "providerLastUpdated",
      "providerLastUpdatedDate",
    ];

    if (activeTab === "booked" || activeTab === "provided") {
      if (requiredFields.every((field) => data[field] !== "" || null)) {
        setValidationError(false);
        return true;
      }
    }
    setValidationError(true);
    return false;
  };

  const handleFilter = (value, key) => {
    let data = { ...filterQuery };
    data[key] = value;
    setFilterQuery(data);
    let data1 = {};
    data1["status"] = data["status"];
    data1["itemId"] = data["Provider"];
    let query1 = "";
    if (data1["status"]) {
      query1 = `&status=${data1["status"]}`;
    }
    if (data1["itemId"]) {
      let queryValue = membership?.purchasedMemberships.filter((item) => item.productId == data1["itemId"]).map(item => item.itemAddress)
      // return itemQuery?.itemAddress
      // query1 = `&queryValue=${data1["itemId"]}`;
      query1 = `&queryFields[]=${queryValue}&queryValue=itemId`
    }
    setPage(1);
    serviceUsageActions.fetchAllServicesUsage(serviceUsageDispatch, limit, offset, query1);
  };

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
              defaultValue={username}
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
      dataIndex: "provider",
      key: "provider",
      render: (text, record, index) => (
        <span>
          {record.editable && !isEdit ? (
            <Select
              placeholder="Provider"
              defaultValue={activeTab === "provided" && organization}
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
                handleInputChange(value.toString(), "provider", index);
              }}
              options={transformData(membership?.purchasedMemberships)}
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
      dataIndex: "itemId",
      key: "itemId",
      render: (text, record, index) => (
        <span>
          {record.editable && !isEdit ? (
            <Select
              placeholder="Membership ID"
              suffixIcon={<CaretDownOutlined />}
              style={{ width: 120 }}
              onChange={(value) =>
                handleInputChange(value, "itemId", index)
              }
              options={membershipList}
            />
          ) : (
            <Typography style={{ color: "#061A6C" }}>
              {membership?.purchasedMemberships.reduce((label, item) => {
                if (item.itemAddress === text) {
                  return item.itemNumber;
                }
                return label;
              }, null)}
            </Typography>
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
              onChange={(value) => handleInputChange(value, "serviceId", index)}
              options={serviceList}
            />
          ) : (
            <Typography style={{ color: "#061A6C" }}>
              {serviceList.reduce((label, item) => {
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
                handleInputChange(
                  new Date(serviceDate).getTime().toString(),
                  "serviceDate",
                  index
                )
              }
            />
          ) : (
            <Typography style={{ color: "#061A6C" }}>{moment.unix(text).format('MM-DD-YYYY')}</Typography>
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
              onChange={(value) => handleInputChange(value, "status", index)}
              options={statusOptions}
            />
          ) : (
            <Typography style={{ color: "#061A6C" }}>
              {statusOptions.reduce((label, item) => {
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
              type="number"
              controls={false}
              value={parseInt(text)}
              placeholder="Price Paid"
              onChange={(value) =>
                handleInputChange(value && value.toString(), "pricePaid", index)
              }
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
                  onClick={() =>
                    handleEditCancel(index, false, "cancel", record)
                  }
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
          {record.editable && !isEdit && (
            <Button
              type="danger"
              icon={<DeleteOutlined />}
              onClick={() => handleDelete(index)}
            />
          )}
        </Space>
      ),
    },
  ];

  const tabOptions = [
    {
      key: "booked",
      label: "Booked",
    },
    {
      key: "provided",
      label: "Provided",
    },
  ];

  const dataLen = serviceUsageState?.servicesUsage?.length;
  const paginationConfig = {
    current: page,
    pageSize: 10, // Number of items to display per page
    total: (dataLen == 10
      ? (((page + 1) * limit) + 1)
      : ((page) * limit)
    ), // Total number of items
    showSizeChanger: false, // Allow users to change the page size
    position: ['bottomCenter']
  };

  const handlePaginationChange = (CPage) => {
    setPage(CPage.current)
    serviceUsageActions.fetchAllServicesUsage(serviceUsageDispatch, limit, (CPage.current - 1) * limit, query);
  }

  const activeTabCheck = activeTab === "booked" ? "Provider" : "User";

  return IsLoading ? (
    <div className="h-96 flex justify-center items-center">
      <Spin size="large" spinning={IsLoading} />
    </div>
  ) : (
    <>
      <Row className="mt-2">
        <Col span={22} className="m-auto">
          <Tabs
            activeKey={activeTab}
            items={tabOptions}
            onChange={handleTabChange}
          />
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
              onChange={(value) => {
                handleFilter(value, activeTabCheck);
              }}
              options={activeTab === "booked" ? transformData(membership?.purchasedMemberships) : userOptions}
            />
            <Select
              placeholder="Status"
              className="ml-2"
              suffixIcon={<CaretDownOutlined />}
              style={{ width: 120 }}
              value={filterQuery["status"]}
              onChange={(value) => {
                handleFilter(value, "status");
              }}
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
            pagination={(dataLen <= 10 && page == 0) ? false : paginationConfig}
            rowKey="key"
            onChange={handlePaginationChange} // Add this line to handle pagination changes
          />
        </Col>
      </Row>
    </>
  );
};

export default ServiceTable;
