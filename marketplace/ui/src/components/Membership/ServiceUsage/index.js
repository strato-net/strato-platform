import React, { useEffect, useState } from "react";
import { Tabs, Table, Select, Button, Row, Col, Typography } from "antd";
import { PlusOutlined, CaretDownOutlined } from "@ant-design/icons";
import "./index.css";
import { generateTableColumns } from "./tableColumns";
import {
  useServiceUsageDispatch,
  useServiceUsageState,
} from "../../../contexts/serviceUsage";
import {
  useAuthenticateDispatch,
  useAuthenticateState,
} from "../../../contexts/authentication";
import {
  useMembershipDispatch,
  useMembershipState,
} from "../../../contexts/membership";
import { useServiceDispatch, useServiceState } from "../../../contexts/service";

import { actions as serviceUsageActions } from "../../../contexts/serviceUsage/actions";
import { actions as servicesActions } from "../../../contexts/service/actions";
import { actions as userAuthActions } from "../../../contexts/authentication/actions";
import { actions as membershipActions } from "../../../contexts/membership/actions";

const limit = 10;
const offset = 0;
const query = "";

const serviceUsageTypes = [
  {
    key: "booked",
    label: "Booked",
  },
  {
    key: "provided",
    label: "Provided",
  },
];

const statusOptions = [
  { value: 1, label: "Requested" },
  { value: 2, label: "Cancelled" },
  { value: 3, label: "Completed" },
];

const getProviderOptions = (data) => {
  const uniqueManufacturers = new Set();
  const resultArray = data.reduce((acc, item) => {
    const productId = item.productId;
    const manufacturer = item.manufacturer;

    if (!uniqueManufacturers.has(manufacturer)) {
      uniqueManufacturers.add(manufacturer);
      acc.push({ value: productId, label: manufacturer });
    }

    return acc;
  }, []);

  return resultArray;
};

const ServiceTable = () => {
  const serviceUsageDispatch = useServiceUsageDispatch();
  const serviceDispatch = useServiceDispatch();
  const authUserDispatch = useAuthenticateDispatch();
  const membershipDispatch = useMembershipDispatch();

  const userCert = useAuthenticateState();
  const servicesState = useServiceState();
  const membership = useMembershipState();
  const serviceUsageState = useServiceUsageState();

  const { isUsersLoading } = userCert;
  const { isServicesLoading } = servicesState;
  const { isPurchasedMembershipLoading } = membership;
  const {
    isServicesUsageLoading,
    isCreateServiceUsageSubmitting,
    isUpdateServicesUsageLoading,
  } = serviceUsageState;

  const username = userCert?.user?.commonName;
  const organization = userCert?.user?.organization;
  const userAddress = userCert?.user?.userAddress;

  const IsLoading =
    isPurchasedMembershipLoading ||
    isServicesUsageLoading ||
    isUsersLoading ||
    isCreateServiceUsageSubmitting ||
    isUpdateServicesUsageLoading;

  const serviceUsageData = serviceUsageState?.servicesUsage;

  const defaultMembership = membership?.purchasedMemberships.map(
    ({ itemAddress, itemNumber }) => {
      return { value: itemAddress, label: itemNumber };
    }
  );
  const serviceListData = servicesState?.services?.map(({ address, name }) => {
    return { value: address, label: name };
  });
  const userListData = userCert?.users?.map(({ userAddress, commonName }) => {
    return { value: userAddress, label: commonName };
  });

  const [membershipList, setMembershipList] = useState(defaultMembership);
  const [serviceList, setServiceList] = useState(serviceListData);
  const [userList, setUserList] = useState(userListData);
  const [providerState, setProviderState] = useState("");
  const [isEdit, setIsEdit] = useState(false);
  const [validationError, setValidationError] = useState(false);
  const [activeTab, setActiveTab] = useState("booked");
  const [tableData, setTableData] = useState([]);
  const [page, setPage] = useState(1);
  const [filterQuery, setFilterQuery] = useState({});

  useEffect(() => {
    setServiceList(serviceListData);
  }, [servicesState]);

  useEffect(() => {
    setMembershipList(defaultMembership);
    // setProviderFilterList(providerFilter)
  }, [membership]);

  useEffect(() => {
    setTableData(serviceUsageData);
  }, [serviceUsageState]);

  useEffect(() => {
    setUserList(userListData);
  }, [userCert]);

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

    providerLastUpdated: userAddress, //user-address
    providerLastUpdatedDate: new Date().getTime().toString(),
  };

  const queryOwner = `&owner=${userAddress}`;
  useEffect(() => {
    if (userAddress) {
      if (activeTab === "booked") {
        serviceUsageActions.fetchBookedServicesUsage(
          serviceUsageDispatch,
          limit,
          offset,
          queryOwner
        );
      } else {
        serviceUsageActions.fetchProvidedServicesUsage(
          serviceUsageDispatch,
          limit,
          offset,
          queryOwner
        );
      }
    }
    servicesActions.fetchService(serviceDispatch, 10, offset, query);
    membershipActions.fetchPurchasedMemberships(membershipDispatch);
    userAuthActions.fetchUsers(authUserDispatch);
  }, [activeTab, userAddress]);

  const handleChangeServiceUsageType = (key) => {
    setFilterQuery({});
    setPage(0);
    setActiveTab(key);
  };

  const handleEditCancel = (key, bool, type, record) => {
    setIsEdit(bool);
    const data = tableData.map((item, index) => {
      if (index === key) {
        item.editable = bool;
      } else if (type === "edit") {
        item.editable = false;
      }
      return item;
    });
    setTableData(data);

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

    const updatedDataObj = UpdatePayloadKeys.reduce((acc, item) => {
      if (
        ["serviceDate", "providerLastUpdatedDate", "pricePaid"].includes(item)
      ) {
        acc[item] = record[item].toString();
      } else {
        acc[item] = record[item];
      }
      return acc;
    }, {});

    const updatedPayload = {
      address: record.address,
      updates: updatedDataObj,
    };

    if (type === "update") {
      if (isEdit) {
        // Uncomment the API call for updating service usage
        serviceUsageActions.UpdateServiceUsage(
          serviceUsageDispatch,
          updatedPayload
        );
      } else {
        updatedDataObj.itemId = record.itemId;
        updatedDataObj.serviceId = record.serviceId;
        serviceUsageActions.createServiceUsage(
          serviceUsageDispatch,
          updatedDataObj
        );
      }
    }
  };

  const handleInputChange = (value, field, key) => {
    const updateTableData = (field, value, key) => {
      const newData = tableData.map((item, index) => {
        if (index === key) {
          item[field] = value || "";
        }
        return item;
      });
      setTableData(newData);
    };

    if (field === "provider") {
      const membershipData = membership?.purchasedMemberships
        .filter(({ manufacturer }) => manufacturer === value)
        .map(({ itemAddress, itemNumber, manufacturer }) => ({
          value: itemAddress,
          label: itemNumber,
          organization: manufacturer,
        }));
      setMembershipList(membershipData);
      // let serviceQuery = `&ownerOrganization=${value}`
      servicesActions.fetchService(serviceDispatch, 10, offset, value);
    } else if (field === "itemId") {
      updateTableData(field, value, key);
    }
    updateTableData(field, value, key);
  };

  const handleAddRow = () => {
    setIsEdit(false);
    let tableCopy = tableData.map((item, index) => {
      item["editable"] = false;
      return item;
    });
    let data = { ...newRowSchema };
    data["key"] = tableCopy.length + 1;
    setTableData([data, ...tableCopy]);
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

    const isRequiredFieldsFilled = requiredFields.every(
      (field) => data[field] !== "" || null
    );

    const isTabValid = activeTab === "booked" || activeTab === "provided";

    const isValid = isTabValid && isRequiredFieldsFilled;

    setValidationError(!isValid);

    return isValid;
  };

  const handleQuery = (data, page) => {
    const queryParameters = {
      owner: userAddress,
    };

    if (data.status) {
      queryParameters.status = data.status;
    }

    if (data.Provider) {
      const itemIds = membership?.purchasedMemberships
        .filter((item) => item.manufacturer === data.Provider)
        .map((item) => item.itemAddress);
      if (itemIds.length > 0) {
        queryParameters["itemId[]"] = itemIds;
      }
    } else if (data.User) {
      queryParameters.providerLastUpdated = data.User;
    }

    const query = Object.entries(queryParameters)
      .map(([key, value]) => `${key}=${value}`)
      .join("&");

    const fetchFunction =
      activeTab === "booked"
        ? serviceUsageActions.fetchBookedServicesUsage
        : serviceUsageActions.fetchProvidedServicesUsage;

    fetchFunction(serviceUsageDispatch, limit, (page - 1) * limit, query);
  };

  const handleFilter = (value, key) => {
    const data = { ...filterQuery, [key]: value };
    setFilterQuery(data);
    handleQuery(data, page);
    setPage(1);
  };

  const columns = generateTableColumns({
    isEdit,
    activeTab,
    username,
    organization,
    setProviderState,
    userList,
    membershipList,
    serviceList,
    getProviderOptions,
    handleInputChange,
    handleEditCancel,
    handleDelete,
    handleValidation,
    validationError,
    membership,
    providerState,
    isServicesLoading,
  });

  const dataLen = serviceUsageState?.servicesUsage?.length;
  const paginationConfig = {
    current: page,
    pageSize: 10, // Number of items to display per page
    total: dataLen == 10 ? (page + 1) * limit + 1 : page * limit, // Total number of items
    showSizeChanger: false, // Allow users to change the page size
    position: ["bottomCenter"],
  };

  const handlePaginationChange = (CPage) => {
    setPage(CPage.current);
    let page = CPage.current;
    if (activeTab === "booked") {
      handleQuery(filterQuery, page);
    } else {
      handleQuery(filterQuery, page);
    }
  };

  const activeTabCheck = activeTab === "booked" ? "Provider" : "User";

  return (
    <>
      <Row className="mt-2">
        <Col span={22} className="m-auto">
          <Tabs
            activeKey={activeTab}
            items={serviceUsageTypes}
            onChange={handleChangeServiceUsageType}
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
            disabled={
              validationError ||
              IsLoading ||
              (tableData && !tableData[0]?.address)
            }
          >
            Add Service Use
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
              disabled={IsLoading}
              value={filterQuery[activeTabCheck]}
              onChange={(value, obj) => {
                handleFilter(
                  activeTab == "booked" ? obj.label : value,
                  activeTabCheck
                );
              }}
              options={
                activeTab === "booked"
                  ? getProviderOptions(membership?.purchasedMemberships)
                  : userList
              }
            />
            <Select
              placeholder="Status"
              className="ml-2"
              suffixIcon={<CaretDownOutlined />}
              disabled={IsLoading}
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
            pagination={dataLen <= 10 && page == 0 ? false : paginationConfig}
            loading={IsLoading}
            rowKey="key"
            onChange={handlePaginationChange} // Add this line to handle pagination changes
          />
        </Col>
      </Row>
    </>
  );
};

export default ServiceTable;
