import { Input, Tabs, Button, notification } from "antd";
import { useState, useEffect } from "react";
import UserManagement from "./userManagement";
import PendingRequests from "./pendingRequests";
import AddUsermodal from "./addUserModal";

import { actions } from "../../contexts/roles/actions";
import { useRoleDispatch, useRoleState } from "../../contexts/roles";

const { Search } = Input;

const Admin = ({ user }) => {
  const [currentTab, setCurrentTab] = useState("Requests");
  const [isAddUserModalOpen, toggleAddUserModal] = useState(false);
  const dispatch = useRoleDispatch();
  const [api, contextHolder] = notification.useNotification();

  const onChange = (key) => {
    setCurrentTab(key);
  };

  const showAddUserModal = () => {
    toggleAddUserModal(true);
  };

  const handleAddUserModal = () => {
    toggleAddUserModal(false);
  };

  const {
    message,
    success,
  } = useRoleState();

  useEffect(() => {
    if (currentTab === 'Requests')
    actions.fetchRequestsList(dispatch);
  }, [dispatch,currentTab]);


  useEffect(() => {
    if (currentTab === 'UserManagement')
     actions.fetchApprovedUsersList(dispatch);
  }, [currentTab, dispatch]);

  const openToast = (placement) => {
    if (success) {
      api.success({
        message: message,
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: message,
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 2,
      });
    }
  };


  return (
    <>
      {contextHolder}
      <Tabs
        className="mx-16 mt-14"
        defaultActiveKey="Requests"
        onChange={onChange}
        activeKey={currentTab}
        tabBarExtraContent={
          <>
            <Search
              placeholder="Search"
              // value={currentTab === "EventType" ? eventTypeQueryValue : eventQueryValue}
              size="middle"
              className="w-80 h-9"
              allowClear
            // onChange={queryHandle}
            />
            {currentTab === "UserManagement" && <Button
              type="primary"
              id="add-user-button"
              className="w-44 h-9 bg-primary !hover:bg-primaryHover ml-3"
              onClick={showAddUserModal}
            >
              Add User
            </Button>}
          </>
        }
        items={[
          {
            label: (
              <p id="request-tab" className="font-medium text-base text-primary">Requests</p>
            ),
            key: "Requests",
            children: <PendingRequests />,
          },
          {
            label: (
              <p id="management-tab" className="font-medium text-base  text-primary">User Management</p>
            ),
            key: "UserManagement",
            children: <UserManagement />,
          }
        ]}
      />
      {isAddUserModalOpen && (
        <AddUsermodal
          open={isAddUserModalOpen}
          handleCancel={handleAddUserModal}
          user={user}
        />
      )}
      {message && openToast("bottom")}
    </>
  );
};

export default Admin;
