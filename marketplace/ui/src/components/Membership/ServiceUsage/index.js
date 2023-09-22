import "./index.css";
import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Tabs,
  Table,
  Select,
  Button,
  Row,
  Col,
  Typography,
  notification,
} from "antd";
import {
  PlusOutlined,
  CaretDownOutlined,
  CloseOutlined,
} from "@ant-design/icons";
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

const { TabPane } = Tabs;

const limit = 10;
const offset = 0;

const statusOptions = [
  { value: 1, label: "Requested" },
  { value: 2, label: "Completed" },
  { value: 3, label: "Cancelled" },
];

const UpdatePayloadKeys = [
  "summary",
  "serviceDate",
  "providerComment",
  "status",
  "pricePaid",
  "paymentStatus",
  "providerLastUpdated",
  "providerLastUpdatedDate",
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

const getNewRowSchema = (address) => {
  return {
    summary: "", //summary
    serviceDate: "", //Date
    providerComment: "", //comment
    status: 1,
    pricePaid: "", //price paid
    editable: true,
    itemId: "", //provider
    serviceId: "", //service
    paymentStatus: 1,

    providerLastUpdated: address, //user-address
    providerLastUpdatedDate: new Date().getTime().toString(),
  };
};

const ServiceTable = () => {
  const navigate = useNavigate();
  let { serviceType } = useParams();

  const [api, contextHolder] = notification.useNotification();
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
    success,
    message,
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

  const serviceUsageData = serviceUsageState?.servicesUsage?.result;
  const totalCount = serviceUsageState?.servicesUsage?.total;

  const defaultMembership = membership?.purchasedMemberships.map(
    ({ itemAddress, itemNumber }) => {
      return { value: itemAddress, label: itemNumber };
    }
  );

  const issuedUser = (apiResponse) => {
    if (!Array.isArray(apiResponse)) {
      return [];
    }

    const uniqueNames = new Set(); // Use a Set to store unique ownerCommonName values
    const transformedArray = apiResponse.reduce((result, item) => {
      if (!uniqueNames.has(item.owner)) {
        uniqueNames.add(item.owner);
        result.push({
          label: item.ownerCommonName,
          value: item.owner
        });
      }
      return result;
    }, []);

    return transformedArray;
  }

  const issuedUserList = issuedUser(membership?.purchasedMemberships);

  const serviceListData = servicesState?.services?.map(({ address, name }) => {
    return { value: address, label: name };
  });
  const userListData = userCert?.users?.map(({ userAddress, commonName }) => {
    return { value: userAddress, label: commonName };
  });

  const UserListData = serviceType == 'booked' ? userListData : issuedUserList;

  const [membershipList, setMembershipList] = useState(defaultMembership);
  const [serviceList, setServiceList] = useState(serviceListData);
  const [userList, setUserList] = useState(UserListData);
  const [providerState, setProviderState] = useState("");
  const [isEdit, setIsEdit] = useState(false);
  const [isNewRow, setIsNewRow] = useState(false);
  const [validationError, setValidationError] = useState(false);
  const [tableData, setTableData] = useState([]);
  const [page, setPage] = useState(1);
  const [filterQuery, setFilterQuery] = useState({});

  useEffect(() => {
    setServiceList(serviceListData);
  }, [servicesState]);

  useEffect(() => {
    setMembershipList(defaultMembership);
  }, [membership]);

  useEffect(() => {
    setTableData(serviceUsageData);
  }, [serviceUsageState]);

  useEffect(() => {
    setUserList(UserListData);
  }, [userCert]);

  const queryOwner = ``;
  useEffect(() => {
    if (userAddress) {
      if (serviceType === "booked") {
        serviceUsageActions.fetchBookedServicesUsage(
          serviceUsageDispatch,
          limit,
          offset,
          queryOwner
        );
        membershipActions.fetchPurchasedMemberships(membershipDispatch);
      } else {
        serviceUsageActions.fetchProvidedServicesUsage(
          serviceUsageDispatch,
          limit,
          offset,
          queryOwner
        );
        membershipActions.fetchIssuedMemberships(membershipDispatch);
        servicesActions.fetchService(serviceDispatch, 10, offset, organization);
      }
    }

    userAuthActions.fetchUsers(authUserDispatch);
  }, [serviceType, userAddress]);

  const newRowSchema = getNewRowSchema(userAddress);

  const handleChangeServiceUsageType = (key) => {
    setFilterQuery({});
    setPage(1);
    navigate(`/memberships/serviceUsage/${key}`);
  };

  const handleEditCancel = (key, bool, type, record) => {
    setIsEdit(bool);
    setIsNewRow(false);
    const data = tableData.map((item, index) => {
      if (index === key) {
        item.editable = bool;
      } else if (type === "edit") {
        item.editable = false;
      }
      return item;
    });
    setTableData(data);

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
        if (serviceType == "booked") {
          serviceUsageActions.UpdateBookedServiceUsage(
            serviceUsageDispatch,
            updatedPayload
          );
        } else {
          serviceUsageActions.UpdateProvidedServiceUsage(
            serviceUsageDispatch,
            updatedPayload
          );
        }
      } else {
        updatedDataObj.itemId = record.itemId;
        updatedDataObj.serviceId = record.serviceId;
        if (serviceType == "booked") {
          serviceUsageActions.createBookedServiceUsage(
            serviceUsageDispatch,
            updatedDataObj
          );
        } else {
          serviceUsageActions.createProvidedServiceUsage(
            serviceUsageDispatch,
            updatedDataObj
          );
        }
      }
      setPage(1);
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
      servicesActions.fetchService(serviceDispatch, 10, offset, value);
    } else if (field === "itemId") {
      updateTableData(field, value, key);
    }else if (field === "providerLastUpdated"){
      const membershipData = membership?.purchasedMemberships
        .filter(({ owner }) => owner === value)
        .map(({ itemAddress, itemNumber, manufacturer }) => ({
          value: itemAddress,
          label: itemNumber,
          organization: manufacturer,
        }));
      setMembershipList(membershipData);
      updateTableData(field, value, key);
    }
    updateTableData(field, value, key);
  };

  const handleAddRow = () => {
    setIsEdit(false);
    setIsNewRow(true);
    let tableCopy = tableData.map((item, index) => {
      item["editable"] = false;
      return item;
    });
    let data = { ...newRowSchema };
    data["key"] = tableCopy.length + 1;
    setTableData([data, ...tableCopy]);
  };

  const handleDelete = (key) => {
    setIsNewRow(false);
    let data = tableData.filter((item, index) => index !== key);
    setTableData(data);
  };

  const handleValidation = (data) => {
    const isRequiredFieldsFilled = [...UpdatePayloadKeys, "serviceId"].every(
      (field) => data[field] !== "" || null
    );
    const isTabValid = serviceType === "booked" || serviceType === "provided";
    const isValid = isTabValid && isRequiredFieldsFilled;
    setValidationError(!isValid);
    return isValid;
  };

  const handleQuery = (data, page) => {
    const queryParameters = {};

    if (data.status) {
      queryParameters["&status"] = data.status;
    }

    if (data.Provider) {
      const itemIds = membership?.purchasedMemberships
        .filter((item) => item.manufacturer === data.Provider)
        .map((item) => item.itemAddress);
      if (itemIds.length > 0) {
        queryParameters["&itemId[]"] = itemIds;
      }
    } else if (data.User) {
      queryParameters["&providerLastUpdated"] = data.User;
    }

    const query = Object.entries(queryParameters)
      .map(([key, value]) => `${key}=${value}`)
      .join("");

    const fetchFunction =
      serviceType === "booked"
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

  const clearFilter = () => {
    setFilterQuery({});
    handleQuery({}, page);
  };

  const columns = generateTableColumns({
    isEdit,
    isNewRow,
    serviceType,
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

  const handlePaginationChange = (CPage) => {
    setPage(CPage.current);
    let page = CPage.current;
    if (serviceType === "booked") {
      handleQuery(filterQuery, page);
    } else {
      handleQuery(filterQuery, page);
    }
  };

  const openToast = (placement) => {
    const messageObj = {
      message: message,
      onClose: serviceUsageActions.resetMessage(serviceUsageDispatch),
      placement,
      key: 1,
    };
    if (success) {
      api.success(messageObj);
    } else {
      api.error(messageObj);
    }
  };

  const activeTabCheck = serviceType === "booked" ? "Provider" : "User";

  return (
    <>
      {contextHolder}
      <Row className="mt-2">
        <Col span={22} className="m-auto">
          <Tabs activeKey={serviceType} onChange={handleChangeServiceUsageType}>
            <TabPane tab="Booked" key="booked" disabled={IsLoading} />
            <TabPane tab="Provided" key="provided" disabled={IsLoading} />
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
            disabled={
              validationError ||
              IsLoading ||
              (tableData && tableData?.length != 0 && !tableData[0]?.address) ||
              page != 1
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
                  serviceType == "booked" ? obj.label : value,
                  activeTabCheck
                );
              }}
              options={
                serviceType === "booked"
                  ? getProviderOptions(membership?.purchasedMemberships)
                  : userList
              }
            />
            <Select
              placeholder="Status"
              className="m-2"
              suffixIcon={<CaretDownOutlined />}
              disabled={IsLoading}
              style={{ width: 120 }}
              value={filterQuery["status"]}
              onChange={(value) => {
                handleFilter(value, "status");
              }}
              options={statusOptions}
            />
            <Button
              icon={<CloseOutlined />}
              disabled={IsLoading || Object.keys(filterQuery).length == 0}
              onClick={clearFilter}
            />
          </span>
        </Col>
      </Row>
      <Row>
        <Col span={22} className="m-auto">
          <Table
            columns={columns}
            dataSource={tableData}
            rowClassName={(record, index) =>
              index % 2 === 0 ? "bg-white" : "bg-secondry"
            }
            pagination={{
              current: page,
              pageSize: 10, // Number of items to display per page
              total: totalCount, // Total number of items
              showSizeChanger: false, // Allow users to change the page size
              position: ["bottomCenter"],
            }}
            loading={IsLoading}
            sticky={true}
            rowKey="key"
            onChange={handlePaginationChange} // Add this line to handle pagination changes
          />
        </Col>
      </Row>
      {message && openToast("bottom")}
    </>
  );
};

export default ServiceTable;
