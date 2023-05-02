import { Typography, Button } from "antd";
import DataTableComponent from "../DataTableComponent";
import classNames from "classnames";
import { STATUS, STATUS_FILTER, APPROVAL_STATUS } from "../../helpers/constants";
import { useRoleState, useRoleDispatch } from "../../contexts/roles";
import { USER_ROLES } from "../../helpers/constants";
import { CheckOutlined, CloseOutlined } from "@ant-design/icons";
import { actions } from "../../contexts/roles/actions";
import "./style.css";

const { Text } = Typography;

const PendingRequests = () => {
  const dispatch = useRoleDispatch();

  const {
    requestsList,
    isRequestsListLoading,
    isAcceptMembershipLoading,
  } = useRoleState();


  const updateRequest = async (index, value) => {
    const user = requestsList[index]
    const body = {
      userMembershipRequestAddress: user.address,
      userMembershipEvent: value
    }
    let isDone = await actions.approveRejectMembershipRequest(dispatch, body, index, requestsList.length);
    if (isDone) {
      actions.fetchRequestsList(dispatch)
    }
  }

  const column = [
    {
      title: <Text className="text-primaryC text-[13px] ml-5">NAME</Text>,
      dataIndex: "ownerCommonName",
      key: "ownerCommonName",
      render: (text) => <p className="text-base ml-5">{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">ORGANIZATION</Text>,
      dataIndex: "ownerOrganization",
      key: "ownerOrganization",
      render: (text) => <p className="text-base">{text}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">ROLE</Text>,
      dataIndex: "role",
      key: "role",
      render: (text) => <p className="text-base">{USER_ROLES[text]}</p>,
    },
    {
      title: <Text className="text-primaryC text-[13px]">STATUS</Text>,
      dataIndex: "state",
      key: "state",
      render: (text) => statusComponent(text),
      filters: STATUS_FILTER,
      onFilter: (value, record) => STATUS[record.state].startsWith(value),
      filterSearch: true,
      width: "15%",
    },
    {
      title: <Text className="text-primaryC text-[13px] ml-5">ACTION</Text>,
      dataIndex: "action",
      key: "action",
      render: (text, record) => {
        let actualIndex = requestsList.findIndex(e => e.address === record.address);
        return <>{STATUS[record.state] === "Pending" ?
          <div className="flex ml-5 gap-3">
            <Button
              onClick={() => {
                updateRequest(actualIndex, APPROVAL_STATUS["Accept"])
              }}
              id="accept"
              disabled={isAcceptMembershipLoading[actualIndex]?.reject}
              loading={isAcceptMembershipLoading[actualIndex]?.accept}
              className="text-success border border-success flex items-center"
              icon={isAcceptMembershipLoading[actualIndex]?.accept
                ? null : <CheckOutlined style={{ color: `${isAcceptMembershipLoading[actualIndex]?.reject ? "#d9d9d9" : "#109B2E"}` }} />}
            >
              {APPROVAL_STATUS[1]}
            </Button>

            <Button
              onClick={() => {
                updateRequest(actualIndex, APPROVAL_STATUS["Reject"])
              }}
              id="reject"
              disabled={isAcceptMembershipLoading[actualIndex]?.accept}
              loading={isAcceptMembershipLoading[actualIndex]?.reject}
              className="text-error border border-error flex items-center"
              icon={isAcceptMembershipLoading[actualIndex]?.reject
                ? null : <CloseOutlined style={{ color: `${isAcceptMembershipLoading[actualIndex]?.accept ? "#d9d9d9" : "#FF0000"}` }} />}
            >
              {APPROVAL_STATUS[2]}
            </Button>
          </div>
          : null}</>
      },
      width: "23%"
    },
  ];

  const statusComponent = (status) => {
    let textClass = "text-orange bg-[#FFF6EC]";
    let actualStatus = STATUS[status]
    if (actualStatus === "Approved") {
      textClass = "text-success  bg-[#EAFFEE]";
    } else if (actualStatus === "Rejected") {
      textClass = "text-error  bg-[#FFF0F0]";
    } else if (actualStatus === "") {
      textClass = "text-white bg-white";
    }

    return (
      <div className={classNames(textClass, "text-center py-1 rounded")}>
        <p>{actualStatus}</p>
      </div>
    );
  };

  return (
    <DataTableComponent
      columns={column}
      isLoading={isRequestsListLoading}
      data={requestsList}
      scrollX="100%"
      pagination={{
        defaultPageSize: 10,
        showSizeChanger: false,
        position: ["bottomCenter"],
    }}
    />
  );
};

export default PendingRequests;
