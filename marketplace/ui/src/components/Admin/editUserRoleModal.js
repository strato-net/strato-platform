import React, { useState } from "react";
import { Modal, Spin, Checkbox, notification, Button } from "antd";
import { USER_ROLES } from "../../helpers/constants";
import { actions as roleActions } from "../../contexts/roles/actions";
import { useRoleDispatch, useRoleState } from "../../contexts/roles";

const EditUserRoleModal = ({
    open,
    handleCancel,
    user,
    defaultRoles
}) => {

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

    const [selectedRoles, setSelectedRoles] = useState(defaultRoles);

    const onRoleChanged = (e) => {
        let valuesChecked = checkValues(e, selectedRoles)
        setSelectedRoles(valuesChecked);
    };

    const roleDispatch = useRoleDispatch();
    const { message, success, isUpdatingMembership } = useRoleState();
    const [api, contextHolder] = notification.useNotification();

    const updateUser = async () => {
        if (user == null || selectedRoles.length === 0) {
            openToast("bottom", "Select a user and a role to add a user");
            return;
        }

        let body = {
            address: user,
            updates: {
                isTradingEntity: selectedRoles.includes(USER_ROLES[2]),
                isCertifier: selectedRoles.includes(USER_ROLES[3]),
                isAdmin: selectedRoles.includes(USER_ROLES[1])
            }
        };


        const result = await roleActions.updateUserMembership(roleDispatch, body);
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
            width="450px"
            footer={[
                <div className="flex justify-evenly">
                    <Button
                        id="submit-button"
                        type="primary"
                        className="w-40 h-9 mb-6 bg-primary !hover:bg-primaryHover"
                        onClick={updateUser}
                        disabled={isUpdatingMembership}
                    >
                        {isUpdatingMembership ? <Spin /> : "Submit"}
                    </Button>
                </div>,
            ]}
        >
            {contextHolder}
            <h1
                className="text-center font-semibold text-lg text-primaryB"
                id="modal-title"
            >
                Edit Role
            </h1>
            <hr className="text-secondryD mt-3" />
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
            {message && openToast("bottom")}
        </Modal>
    );
};

export default EditUserRoleModal;
