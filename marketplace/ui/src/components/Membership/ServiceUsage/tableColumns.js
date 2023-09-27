import React from "react";
import {
  Select,
  Input,
  DatePicker,
  Typography,
  InputNumber,
  Button,
  Space,
  Spin,
} from "antd";
import {
  LockOutlined,
  CaretDownOutlined,
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import dayjs from "dayjs";

dayjs.locale('es');

const disabledDate = (current) => {
  return current && dayjs(current).isBefore(dayjs().startOf('day'));
};

export function generateTableColumns({
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
  statusOptions,
}) {
  const renderUserColumn = (
    text,
    record,
    index,
    userList,
    isEdit,
    serviceType,
    username,
    handleInputChange
  ) => {
    return (
      <span>
        {record.editable && !isEdit ? (
          <Select
            placeholder="User"
            defaultValue={serviceType == "booked" && username}
            suffixIcon={
              serviceType === "booked" ? (
                <LockOutlined />
              ) : (
                <CaretDownOutlined />
              )
            }
            disabled={serviceType === "booked"}
            style={{ width: 120 }}
            onChange={(value) =>
              handleInputChange(value, "bookedUserAddress", index)
            }
            options={userList}
          />
        ) : (
          <Typography style={{ color: "#061A6C" }}>
            {record.bookedUserName}
          </Typography>
        )}
      </span>
    );
  };

  const renderProviderColumn = (
    text,
    record,
    index,
    isEdit,
    serviceType,
    organization,
    setProviderState,
    handleInputChange,
    getProviderOptions
  ) => {
    return (
      <span>
        {record.editable && !isEdit ? (
          <Select
            placeholder={
              serviceType === "provided" && organization
                ? organization
                : "Provider"
            }
            suffixIcon={
              serviceType === "provided" ? (
                <LockOutlined />
              ) : (
                <CaretDownOutlined />
              )
            }
            disabled={serviceType === "provided"}
            style={{ width: 120 }}
            onChange={(value, obj) => {
              setProviderState(obj.value.toString());
              handleInputChange(obj.label.toString(), "provider", index);
            }}
            options={getProviderOptions(membership?.purchasedMemberships)}
          />
        ) : (
          <span>{text}</span>
        )}
      </span>
    );
  };

  const renderMembershipIDColumn = (
    text,
    record,
    index,
    membershipList,
    handleInputChange
  ) => {
    return (
      <span>
        {record.editable ? (
          <Select
            disabled={!record.provider && !record.bookedUserAddress}
            placeholder={"Membership ID"}
            value={record.itemId}
            suffixIcon={<CaretDownOutlined />}
            style={{ width: 120 }}
            onChange={(value, obj) =>
              handleInputChange(obj.value, "itemId", index)
            }
            options={membershipList}
          />
        ) : (
          <Typography style={{ color: "#061A6C" }}>
            {record.membershipNumber}
          </Typography>
        )}
      </span>
    );
  };

  const renderServiceColumn = (
    text,
    record,
    index,
    isEdit,
    providerState,
    isServicesLoading,
    handleInputChange,
    serviceList
  ) => {
    return (
      <span>
        {record.editable && !isEdit ? (
          <Select
            disabled={!record.itemId || isServicesLoading}
            placeholder="Service"
            defaultValue={record.serviceId}
            suffixIcon={
              isServicesLoading ? <Spin size="small" /> : <CaretDownOutlined />
            }
            style={{ width: 120 }}
            onChange={(value) => handleInputChange(value, "serviceId", index)}
            options={serviceList}
          />
        ) : (
          <Typography style={{ color: "#061A6C" }}>
            {record.serviceName}
          </Typography>
        )}
      </span>
    );
  };

  const renderSummaryColumn = (
    text,
    record,
    index,
    isEdit,
    handleInputChange
  ) => {
    return (
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
    );
  };

  const renderDateColumn = (text, record, index, isEdit, handleInputChange) => {
    return (
      <span>
        {record.editable ? (
          <DatePicker
            disabledDate={disabledDate}
            defaultValue={text ? dayjs(text) : ''}
            onChange={(serviceDate, dateString) =>
              handleInputChange(
                dayjs(serviceDate).valueOf(),
                "serviceDate",
                index
              )
            }
          />
        ) : (
          <Typography style={{ color: "#061A6C" }}>
            {dayjs(text).format("MM-DD-YYYY")}
          </Typography>
        )}
      </span>
    );
  };

  const renderCommentsColumn = (
    text,
    record,
    index,
    isEdit,
    handleInputChange
  ) => {
    return (
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
    );
  };

  const renderStatusColumn = (
    text,
    record,
    index,
    isEdit,
    handleInputChange,
    statusOptions
  ) => {
    return (
      <span>
        {record.editable ? (
          <Select
            value={text}
            placeholder="Status"
            suffixIcon={<CaretDownOutlined />}
            // disabled={serviceType === "provided"}
            style={{ minWidth: "100px" }}
            onChange={(value) => handleInputChange(value, "status", index)}
            options={statusOptions}
          />
        ) : (
          <Typography style={{ color: "#061A6C" }}>
            {statusOptions?.reduce((label, item) => {
              if (item.value == text) {
                return item.label;
              }
              return label;
            }, null)}
          </Typography>
        )}
      </span>
    );
  };

  const renderPricePaidColumn = (
    text,
    record,
    index,
    isEdit,
    handleInputChange
  ) => {
    return (
      <span>
        {record.editable ? (
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
    );
  };

  return [
    {
      title: "User",
      dataIndex: "bookedUserAddress",
      key: "bookedUserAddress",
      render: (text, record, index) =>
        renderUserColumn(
          text,
          record,
          index,
          userList,
          isEdit,
          serviceType,
          username,
          handleInputChange
        ),
    },
    {
      title: "Provider",
      dataIndex: "provider",
      key: "provider",
      render: (text, record, index) =>
        renderProviderColumn(
          text,
          record,
          index,
          isEdit,
          serviceType,
          organization,
          setProviderState,
          handleInputChange,
          getProviderOptions
        ),
    },
    {
      title: "Membership ID",
      dataIndex: "itemId",
      key: "itemId",
      render: (text, record, index) =>
        renderMembershipIDColumn(
          text,
          record,
          index,
          membershipList,
          handleInputChange
        ),
    },
    {
      title: "Service",
      dataIndex: "serviceId",
      key: "serviceId",
      render: (text, record, index) =>
        renderServiceColumn(
          text,
          record,
          index,
          isEdit,
          providerState,
          isServicesLoading,
          handleInputChange,
          serviceList
        ),
    },
    {
      title: "Summary",
      dataIndex: "summary",
      key: "summary",
      render: (text, record, index) =>
        renderSummaryColumn(text, record, index, isEdit, handleInputChange),
    },
    {
      title: "Date",
      dataIndex: "serviceDate",
      key: "serviceDate",
      render: (text, record, index) =>
        renderDateColumn(text, record, index, isEdit, handleInputChange),
    },
    {
      title: "Comments",
      dataIndex: "providerComment",
      key: "providerComment",
      render: (text, record, index) =>
        renderCommentsColumn(text, record, index, isEdit, handleInputChange),
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (text, record, index) =>
        renderStatusColumn(
          text,
          record,
          index,
          isEdit,
          handleInputChange,
          statusOptions
        ),
    },
    {
      title: "Price Paid",
      dataIndex: "pricePaid",
      key: "pricePaid",
      render: (text, record, index) =>
        renderPricePaidColumn(text, record, index, isEdit, handleInputChange),
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
              disabled={
                !handleValidation(record) || validationError || isNewRow
              }
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
}
