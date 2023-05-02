import React, { useState, useEffect } from "react";
import { Modal, Spin, Checkbox, Select, Form, notification, Button } from "antd";
import { USER_ROLES } from "../../helpers/constants";
import { actions } from "../../contexts/authentication/actions";
import { useAuthenticateDispatch, useAuthenticateState } from "../../contexts/authentication";
import { actions as roleActions } from "../../contexts/roles/actions";
import { useRoleDispatch, useRoleState } from "../../contexts/roles";

const { Option } = Select;

const AddUsermodal = ({
    open,
    handleCancel,
    user,
}) => {

    const [name, setName] = useState(null);
    const [names, setNames] = useState([]);
    const roles = [USER_ROLES["2"], USER_ROLES["3"], USER_ROLES["1"]];
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

    const [selectedRoles, setSelectedRoles] = useState([]);

    const onRoleChanged = (e) => {
        let valuesChecked = checkValues(e, selectedRoles)
        setSelectedRoles(valuesChecked);
    };
    const dispatch = useAuthenticateDispatch();
    const { users, isUsersLoading } = useAuthenticateState();

    const roleDispatch = useRoleDispatch();
    const { message, success, isAddingMembership } = useRoleState();
    const [api, contextHolder] = notification.useNotification();

    useEffect(() => {
        actions.fetchUsers(dispatch);
    }, [dispatch]);

    useEffect(() => {
        let arr = users.filter(item => item.organization === user.organization)
        setNames(arr.filter(item => item.commonName !== user.commonName));
    }, [users, user])

    const addUser = async () => {
        if (name == null || selectedRoles.length === 0) {
            openToast("bottom", "Select a user and a role to add a user");
            return;
        }

        let body = {
            userAddress: name,
            isTradingEntity: selectedRoles.includes(USER_ROLES[2]),
            isCertifier: selectedRoles.includes(USER_ROLES[3]),
            isAdmin: selectedRoles.includes(USER_ROLES[1])
        };


        const result = await roleActions.addUserMembership(roleDispatch, body);
        if (result) {
            handleCancel();
            await roleActions.fetchApprovedUsersList(roleDispatch);
        }

    }

    const openToast = (placement, msg) => {
        if (!success) {
            api.error({
                message: msg == null ? message : msg,
                onClose: roleActions.resetMessage(roleDispatch),
                placement,
                key: 2,
            });
        }
    };


    return (
        <Modal
            open={open}
            centered
            onCancel={handleCancel}
            width="425px"
            footer={[
                <div className="flex justify-evenly">
                    <Button
                        id='submit-button'
                        type="primary"
                        className="w-40 h-9 mb-6 bg-primary !hover:bg-primaryHover"
                        onClick={addUser}
                        disabled={isAddingMembership}
                    >
                        {isAddingMembership ? <Spin /> : "Add User"}
                    </Button>
                </div>,
            ]}
        >
            {contextHolder}
            <h1
                className="text-center font-semibold text-lg text-primaryB"
                id="modal-title"
            >
                Add User
            </h1>
            <hr className="text-secondryD mt-3" />
            {
                isUsersLoading ?
                    <div className="h-44 flex justify-center items-center">
                        <Spin spinning={isUsersLoading} size="large" />
                    </div>
                    : <Form layout="vertical" className="mt-5">
                        <Form.Item label="Name" className="mt-5">
                            <Select
                                id="name"
                                placeholder="Select Name"
                                showSearch
                                allowClear
                                name="name"
                                value={name}
                                onChange={(value) => {
                                    setName(value);
                                }}
                                filterOption={(input, option) =>
                                    (option?.children ?? '').toLowerCase().includes(input.toLowerCase())
                                  }
                            >
                                {names.map((e, index) => (
                                    <Option value={e.userAddress} key={index}>
                                        {e.commonName}
                                    </Option>
                                ))}
                            </Select>
                        </Form.Item>
                        <div className="flex flex-col  my-10">
                            <p className="font-semibold text-primaryC text-xs mb-5">
                                Please select the role to assign
                            </p>
                            <Checkbox.Group
                                value={selectedRoles}
                            >
                                <div className="flex gap-8 w-[28rem]">
                                    {roles.map((role, index) => (
                                        <Checkbox value={role} key={index} className="m-0" onChange={onRoleChanged}>
                                            {decodeURIComponent(role)}
                                        </Checkbox>
                                    ))}
                                </div>
                            </Checkbox.Group>
                        </div>
                        <hr className="text-secondryD my-5" />
                    </Form>
            }
            {message && openToast("bottom")}
        </Modal>
    );
};

export default AddUsermodal;
