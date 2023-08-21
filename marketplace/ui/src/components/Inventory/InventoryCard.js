import React, { useState } from "react";
import classNames from "classnames";
import { Card, Popover, Button } from "antd";
import {
  MoreOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  SyncOutlined,
  PieChartOutlined
} from "@ant-design/icons";
import PreviewInventoryModal from "./PreviewInventoryModal";
import { useNavigate } from "react-router-dom";
import { INVENTORY_STATUS } from "../../helpers/constants";
import UpdateInventoryModal from "./UpdateInventoryModal";
import RetireModal from "./RetireModal";
import ResellModal from "./ResellModal";
import routes from "../../helpers/routes";

const InventoryCard = ({ inventory, category, debouncedSearchTerm, id }) => {
  const [openPop, setOpenPop] = useState(false);
  const [open, setOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [retireModalOpen, setRetireModalOpen] = useState(false);
  const [resellModalOpen, setResellModalOpen] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const navigate = useNavigate();
  const naviroute = routes.InventoryDetail.url;

  const showModalEdit = () => {
    hide();
    setOpenEdit(true);
  };

  const handleCancel = () => {
    setOpen(false);
  };

  const handleCancelEdit = () => {
    setOpenEdit(false);
  };

  const hide = () => {
    setOpenPop(false);
  };
  const handleOpenChange = (newOpen) => {
    setOpenPop(newOpen);
  };

  const showEditModal = () => {
    hide();
    setEditModalOpen(true);
  };

  const handleEditModalClose = () => {
    setEditModalOpen(false);
  };

  const showRetireModal = () => {
    hide();
    setRetireModalOpen(true);
  };

  const handleRetireModalClose = () => {
    setRetireModalOpen(false);
  };

  const showResellModal = () => {
    hide();
    setResellModalOpen(true);
  };

  const handleResellModalClose = () => {
    setResellModalOpen(false);
  };

  const callDetailPage = () => {
    navigate(`${naviroute.replace(":id", inventory.address)}`, { state: { isCalledFromInventory: true } });
  }

  return (
    <Card className="w-full mt-6">
      <div className="flex" id={id}>
        <img className="w-52 object-cover" alt="" src={inventory.imageUrl} />
        <div className="ml-12 w-full">
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <h3 className="font-semibold text-primaryB text-xl">
                {decodeURIComponent(inventory.name)}
              </h3>
              {category &&
                <p className="font-medium text-secondryB text-base ml-2">
                  ({category.name})
                </p>
              }
            </div>
            <div className="flex items-center">
              <Button type="text"
                className="text-primary text-sm cursor-pointer"
                onClick={callDetailPage}
              >
                Preview
              </Button>
              <Popover
                placement="bottomLeft"
                open={openPop}
                className="ml-2"
                id="sideMenu"
                onOpenChange={handleOpenChange}
                title={
                  <div className="font-medium">
                    <div
                      className="flex items-center cursor-pointer"
                      onClick={(item) => navigate(routes.EventList.url.replace(":id", inventory.address))}
                    >
                      <EyeOutlined />
                      <p className="ml-3">View Event</p>
                    </div>
                    <div
                      className="flex items-center mt-2 cursor-pointer"
                      onClick={showEditModal}
                    >
                      <EditOutlined />
                      <p className="ml-3">Edit</p>
                    </div>
                  {inventory.category === 'Carbon' &&(                    
                    <div
                      className="flex items-center mt-2 cursor-pointer"
                      onClick={showRetireModal}
                    >
                      <SyncOutlined />
                      <p className="ml-3">Retire</p>
                    </div>
                  )}
                  {inventory.category === 'Carbon' &&(
                    <div
                      className="flex items-center mt-2 cursor-pointer"
                      onClick={showResellModal}
                    >
                      <PieChartOutlined />
                      <p className="ml-3">Resell</p>
                    </div>
                  )}
                  </div>
                }
                trigger="click"
              >
                <MoreOutlined />
              </Popover>
            </div>
          </div>
          <div className="flex mt-1 items-center">
            <p className="text-primaryC text-sm w-40">Price Per Unit</p>
            <p text-secondryB text-sm>
              :
            </p>
            <p className="text-secondryB text-sm ml-3">
              $ {inventory.pricePerUnit}
            </p>
          </div>
          <div className="flex mt-1 items-center">
            <p className="text-primaryC text-sm w-40">Remaining Quantity</p>
            <p text-secondryB text-sm>
              :
            </p>
            <p className="text-error text-sm ml-3">
              {inventory.availableQuantity}
            </p>
          </div>
          <div className="flex mt-1 items-center">
            <p className="text-primaryC text-sm w-40">Retired Quantity</p>
            <p text-secondryB text-sm>
              :
            </p>
            <p className="text-error text-sm ml-3">
              {inventory.retiredQuantity}
            </p>
          </div>
          <div className="flex mt-1 items-center">
            <p className="text-primaryC text-sm w-40">Vintage</p>
            <p text-secondryB text-sm>
              :
            </p>
            <p className="text-error text-sm ml-3">
              {inventory.vintage === 0 ? "N/A" : inventory.vintage}
            </p>
          </div>
          <div className="flex mt-2.5">
            <div
              className={classNames(
                inventory.status === 1
                  ? "text-primary bg-[#EBF7FF]"
                  : "text-error bg-[#FFF0F0]",
                "text-center py-1 rounded w-28 text-sm "
              )}
            >
              <p>{INVENTORY_STATUS[inventory.status]}</p>
            </div>
            <div
              className={classNames(
                inventory.isActive
                  ? "text-success bg-[#EAFFEE]"
                  : "text-orange bg-[#FFF6EC]",
                "text-center py-1 rounded w-24 text-sm ml-4"
              )}
            >
              <p>{inventory.isActive ? "Active" : "Inactive"}</p>
            </div>
          </div>
        </div>
      </div>
      {open && (
        <PreviewInventoryModal
          open={open}
          handleCancel={handleCancel}
          inventory={inventory}
          category={category}
        />
      )}
      {editModalOpen && (
        <UpdateInventoryModal
          open={editModalOpen}
          handleCancel={handleEditModalClose}
          debouncedSearchTerm={debouncedSearchTerm}
          inventoryToUpdate={{
            inventory: inventory,
            category: category,
          }}
        />
      )}
      {retireModalOpen && (
        <RetireModal
          open={retireModalOpen}
          handleCancel={handleRetireModalClose}
          inventory={inventory}
        />
      )}
      {resellModalOpen && (
        <ResellModal
          open={resellModalOpen}
          handleCancel={handleResellModalClose}
          inventory={inventory}
          
        />
      )}
    </Card>
  );
};

export default InventoryCard;
