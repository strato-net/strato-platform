import { Button, notification, Input, Space,  } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { PageHeader } from '@ant-design/pro-layout'
import React, { useEffect, useState, useRef } from "react";
import DataTableComponent from "../DataTableComponent";
import routes from "../../helpers/routes";
import CreateModal from "./CreateModal";
import UpdateModal from "./UpdateModal";
import ImportCSVModal from "./ImportCSVModal";
import { blue } from '@ant-design/colors';

import { actions } from "../../contexts/subCategory/actions";
import { useSubCategoryDispatch, useSubCategoryState } from "../../contexts/subCategory";
import TransferOwnershipModal from "./TransferOwnershipModal";
import useDebounce from "../UseDebounce";

const SubCategory = () => {
  let queryValue = '', offset = 0;
  const limit = 10;
  const [selectedObj, setSelectedObj] = useState([]);
  const [isCreateModalOpen, toggleCreateModal] = useState(false);
  const [isTransferOwnershipModalOpen, toggleTransferOwnershipModal] = useState(false);
  const [isUpdateModalOpen, toggleUpdateModal] = useState(false);
  const [api, contextHolder] = notification.useNotification();
  const naviroute = routes.SubCategoryDetail.url;
  const openToast = (placement) => {
    if (success) {
      api.success({
        message: message,
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 1
      })
    }
    else {
      api.error({
        message: message,
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 2
      })
    }
  }

  const dispatch = useSubCategoryDispatch();
  const debouncedSearchTerm = useDebounce(queryValue, 1000);

  const { 
    subCategorys,
    issubCategorysLoading,
    isCreateSubCategorySubmitting,
    isOwnershipsubCategoryTransferring,
    issubCategoryUpdating,
    message,
    success,
    isAssetImportInProgress,
    assetsUploaded,
    assetsUploadedErrors,
    isImportAssetsModalOpen,
  } = useSubCategoryState();


  useEffect(() => {
    actions.fetchSubCategory(
      dispatch,
      limit,
      offset,
      debouncedSearchTerm
    );
  }, [dispatch, limit, offset, debouncedSearchTerm]);


  const searchInput = useRef(null);
  const handleSearch = (selectedKeys, confirm, dataIndex) => {
    confirm();
  };
  const handleReset = (clearFilters) => {
    clearFilters();
  };
  const getColumnSearchProps = (dataIndex) => ({
    filterDropdown: ({ setSelectedKeys, selectedKeys, confirm, clearFilters }) => (
      <div
        style={{padding: 8}}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <Input
          ref={searchInput}
          placeholder={'Search'}
          value={selectedKeys[0]}
          onChange={(e) => setSelectedKeys(e.target.value ? [e.target.value] : [])}
          onPressEnter={() => handleSearch(selectedKeys, confirm, dataIndex)}
          style={{marginBottom: 8, display: 'block'}}
        />
        <Space>
          <Button
            type="primary"
            onClick={() => handleSearch(selectedKeys, confirm, dataIndex)}
            icon={<SearchOutlined />}
            size="small"
            style={{width: 90}}
          >
            Search
          </Button>
          <Button
            onClick={() => clearFilters && handleReset(clearFilters)}
            size="small"
            style={{width: 90}}
          >
            Reset
          </Button>
        </Space>
      </div>
    ),
    filterIcon: (filtered) => (
      <SearchOutlined
        style={{color: filtered ? blue.primary : undefined}}
      />
    ),
    onFilter: (value, record) =>
      record[dataIndex].toString().toLowerCase().includes(value.toLowerCase()),
    onFilterDropdownOpenChange: (visible) => {
      if (visible) {
        setTimeout(() => searchInput.current?.select(), 100);
      }
    }
  });

  for (const value in Object.values(subCategorys)) {
    if (subCategorys[value].ownerOrganizationalUnit === '') {
      subCategorys[value].ownerOrganizationalUnit = 'N/A';
    }
  }

  let columns = [
    {
      title: "name",
      dataIndex: "name",
      ...getColumnSearchProps("name")
    },
    {
      title: "description",
      dataIndex: "description",
      ...getColumnSearchProps("description")
    },
    {
      title: "category",
      dataIndex: "category",
      ...getColumnSearchProps("category")
    },
    {
      title: "createdAt",
      dataIndex: "createdAt",
      ...getColumnSearchProps("createdAt")
    },
    {
      title: 'Organization',
      dataIndex: 'ownerOrganization',
      ...getColumnSearchProps('ownerOrganization')
    },
    {
      title: 'Organizational Unit',
      dataIndex: 'ownerOrganizationalUnit',
      ...getColumnSearchProps('ownerOrganizationalUnit')
    },
    {
      title: 'Common Name',
      dataIndex: 'ownerCommonName',
      ...getColumnSearchProps('ownerCommonName')
    },
  ]

  return (
    <div>
      {contextHolder}
      <PageHeader
        title="SubCategory"
        extra={[
          <Button disabled={!selectedObj.length} onClick={() => {
            toggleUpdateModal(!isUpdateModalOpen);
          }}>
            Edit
          </Button>,
          <Button disabled={!selectedObj.length} onClick={() => {
            toggleTransferOwnershipModal(!isTransferOwnershipModalOpen)
          }}>
            Transfer Ownership
          </Button>,
          <Button onClick={() => {
            actions.openImportCSVmodal(dispatch)
          }}>
            Import CSV
          </Button>,
          <Button type="primary" onClick={() => {
            toggleCreateModal(!isCreateModalOpen);
          }}>
            Create SubCategory
          </Button>,
        ]}
      />
      <DataTableComponent
        columns={columns}
        data={ subCategorys}
        isLoading={issubCategorysLoading}
        naviroute={naviroute}
        rowKey={'chainId'}   
        setSelectedObj={setSelectedObj}
        selectedRowObj={selectedObj}
      />
      {isCreateModalOpen && <CreateModal
        isCreateModalOpen={isCreateModalOpen}
        toggleCreateModal={toggleCreateModal}
        dispatch={dispatch}
        actions={actions}
        isCreateSubmitting={isCreateSubCategorySubmitting}
        debouncedSearchTerm={debouncedSearchTerm}
      />}
      {isUpdateModalOpen && <UpdateModal
        isUpdateModalOpen={isUpdateModalOpen}
        toggleUpdateModal={toggleUpdateModal}
        dispatch={dispatch}
        actions={actions}
        isUpdating={issubCategoryUpdating}
        debouncedSearchTerm={debouncedSearchTerm}
        selectedObj={selectedObj}
      />}
      {isImportAssetsModalOpen && <ImportCSVModal
        dispatch={dispatch}
        actions={actions}
        isAssetImportInProgress={isAssetImportInProgress}
        assetsUploaded={assetsUploaded}
        assetsUploadedErrors={assetsUploadedErrors}
        isImportAssetsModalOpen={isImportAssetsModalOpen}
      />}
      {isTransferOwnershipModalOpen && <TransferOwnershipModal
        isTransferOwnershipModalOpen={isTransferOwnershipModalOpen}
        toggleTransferOwnershipModal={toggleTransferOwnershipModal}
        selectedObj={selectedObj}
        dispatch={dispatch}
        actions={actions}
        isTransferring={isOwnershipsubCategoryTransferring}
      />}
      {message && openToast('bottom')}
    </div>
  );
};

export default SubCategory;
