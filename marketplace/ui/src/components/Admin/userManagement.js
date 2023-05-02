import { Typography } from "antd";
import DataTableComponent from "../DataTableComponent";
import { Edit, EditWhite } from "../../images/SVGComponents";
import { useState, useEffect } from "react";
import EditUserRoleModal from "./editUserRoleModal";
import { USER_ROLES } from "../../helpers/constants";
import { useRoleState } from "../../contexts/roles";
import { arrayToStr } from "../../helpers/utils";

const { Text } = Typography

const UserManagement = () => {
  const [user, setUser] = useState(null);
  const [isEditModalOpen, toggleEditModal] = useState(false);
  const [isEditHover, setIsEditHover] = useState([false, false, false, false]);
  const [defaultRoles, setDefaultRoles] = useState([]);

  const [parsedUsersList, setParsedUsersList] = useState([]);



  const showEditModal = (text, userAddress) => {
    setDefaultRoles(text);
    setUser(userAddress)
    toggleEditModal(true);
  };

  const handleEditCancel = () => {
    toggleEditModal(false);
  };

  const showEditHover = (index) => {
    let editHover = [...isEditHover];
    editHover[index] = true;
    setIsEditHover(editHover);
  }

  const showEditButton = (index) => {
    let editHover = [...isEditHover];
    editHover[index] = false;
    setIsEditHover(editHover);
  }



  const {
    approvedUsersList,
    isApprovedUsersListLoading,
  } = useRoleState();


  const column = [
    {
      title: <Text className="text-primaryC text-[13px] ml-5">Name</Text>,
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
      render: (text) => {

        let roles = [];
        if (text.isAdmin) roles.push(USER_ROLES[1])
        if (text.isTradingEntity) roles.push(USER_ROLES[2])
        if (text.isCertifier) roles.push(USER_ROLES[3]);

        return <p className="text-base">{arrayToStr(roles)}</p>
      },
    },
    {
      title: <Text className="text-primaryC text-[13px]">ACTION</Text>,
      dataIndex: "action",
      key: "action",
      render: (text, record, index) => {
        let roles = [];
        let userAddress;
        if (text.isAdmin) roles.push(USER_ROLES[1])
        if (text.isTradingEntity) roles.push(USER_ROLES[2])
        if (text.isCertifier) roles.push(USER_ROLES[3]);
        userAddress = text.userAddress;
        return <div className="flex">
          {isEditHover[index] ?
            <div
              className="w-24 h-8 mr-8 flex justify-center items-center rounded-md cursor-pointer bg-success"
              onClick={() => { showEditModal(roles, userAddress) }}
              onMouseOut={() => showEditButton(index)}>
              <EditWhite />
              <Text className="ml-1 text-white">Edit</Text>
            </div> :
            <div
              id="edit-button"
              className="w-24 h-8 mr-8 flex justify-center items-center border border-success rounded-md cursor-pointer"
              onMouseOver={() => showEditHover(index)}>
              <Edit />
              <Text className="ml-1 text-success">Edit</Text>
            </div>}
        </div>
      },
    },
  ];

  useEffect(() => {
    let temp = [];
    temp = approvedUsersList.map(elem => {
      return {
        ...elem,
        role: {
          isAdmin: elem.isAdmin,
          isTradingEntity: elem.isTradingEntity,
          isCertifier: elem.isCertifier,
          userAddress: elem.address,
        },
        action: {
          isAdmin: elem.isAdmin,
          isTradingEntity: elem.isTradingEntity,
          isCertifier: elem.isCertifier,
          userAddress: elem.address,
        }
      }
    });
    setParsedUsersList(temp);
  }, [approvedUsersList]);


  return (
    <>
      <DataTableComponent
        columns={column}
        isLoading={isApprovedUsersListLoading}
        data={parsedUsersList}
        pagination={{
          defaultPageSize: 10,
          showSizeChanger: false,
          position: ["bottomCenter"],
      }}
      />
      {isEditModalOpen && (
        <EditUserRoleModal
          open={isEditModalOpen}
          handleCancel={handleEditCancel}
          user={user}
          defaultRoles={defaultRoles}
        />
      )}
    </>
  );
};

export default UserManagement;
