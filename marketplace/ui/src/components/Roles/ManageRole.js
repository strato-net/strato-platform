
import { Card, Divider, Checkbox, Button, notification, Spin } from "antd";
import React, { useState, useEffect } from "react";
import SuccessModal from "./SuccessModal";
import { USER_ROLES } from "../../helpers/constants";
import { actions } from "../../contexts/roles/actions";
import { actions as authActions } from "../../contexts/authentication/actions";
import { useRoleDispatch, useRoleState } from "../../contexts/roles";
import { useAuthenticateDispatch, useAuthenticateState } from "../../contexts/authentication";
import { useNavigate } from "react-router-dom";
import routes from "../../helpers/routes";


const ManageRole = () => {
  const dispatch = useRoleDispatch();
  const authDispatch = useAuthenticateDispatch();
  const { message, success, isRequestingMembership } = useRoleState();
  const { isCheckingAuthentication, user } = useAuthenticateState();
  const navigate = useNavigate();
  const [api, contextHolder] = notification.useNotification();


  useEffect(() => {
    authActions.check(authDispatch);
  }, [authDispatch]);

  const checkValues = (e, arr) => {
    let tempValues = [...arr];
    const existingIndex = tempValues.indexOf(e.target.value);
    if (e.target.checked) {
      if (existingIndex === -1) {
        tempValues.push(e.target.value)
      }
    } else {
      tempValues.splice(existingIndex, 1);
    }
    return tempValues;
  }

  const [open, setOpen] = useState(false);

  const [selectedRoles, setSelectedRoles] = useState([]);
  const onRoleChanged = (e) => {
    let valuesChecked = checkValues(e, selectedRoles)
    setSelectedRoles(valuesChecked);
  };

  const roles = [USER_ROLES["2"], USER_ROLES["3"], USER_ROLES["1"]];

  const sendRequestForRole = async () => {
    let roleIndexes = [];
    selectedRoles.forEach(element => {
      if(!user.roles.includes(element)){
        roleIndexes.push(parseInt(Object.keys(USER_ROLES).find((key) => USER_ROLES[key] === element)))
      }
    });

    let body = {
      roles: roleIndexes,
    };

    const result = await actions.requestUserMembership(dispatch, body);
    if (result) {
      setOpen(true);
      setTimeout(function () {
        navigate(routes.WaitingApproval.url)
      }, 2000);
    }

  }

  const openToast = (placement) => {
    if (!success) {
      api.error({
        message: message,
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 2,
      });
    }
  };

  useEffect(() => {
    let sRoles = [];
    user.roles.forEach(element => {
      sRoles.push(element);
    });
    user.pendingMembershipRequests.forEach(element => {
      sRoles.push(USER_ROLES[element]);
    });

    setSelectedRoles(sRoles);
  }, [user])




  return (
    <div>
      {contextHolder}
      <div className="flex justify-center mt-32">
        {
          isCheckingAuthentication ? <Spin size="large" /> : <Card className="w-[28rem]" bodyStyle={{ padding: "0" }}>
            <h1 className="text-center text-black text-xl font-bold mt-6">Manage Role</h1>
            <Divider />
            <p className="text-left ml-6">Please select to assign/manage the role </p>
            <div className="mt-6 ml-6">
              <Checkbox.Group
                value={selectedRoles}
              >
                <div className="flex gap-8 w-[28rem]">

                  {roles.map((role, index) => (
                    <Checkbox value={role} key={index} className="m-0" onChange={onRoleChanged} disabled={user.roles.includes(role) || user.pendingMembershipRequests.includes(parseInt(Object.keys(USER_ROLES).find((key) => USER_ROLES[key] === role))) }>
                      {decodeURIComponent(role)}
                    </Checkbox>
                  ))}
                </div>
              </Checkbox.Group>
            </div>
            <Divider />
            <div className="text-center">
              <Button
                id="submit-button"
                type="primary"
                className="w-40 h-9 mb-6 bg-primary !hover:bg-primaryHover"
                onClick={sendRequestForRole}
                disabled={isRequestingMembership}
              >
                {isRequestingMembership ? <Spin /> : "Submit"}
              </Button>
            </div>
          </Card>
        }
      </div>
      <SuccessModal open={open} handleCancel={() => { setOpen(false) }} />
      {message && openToast("bottom")}
    </div>
  );
};

export default ManageRole;

