import React, { useState } from "react";
import classNames from "classnames";
import { Card, Popover, Button } from "antd";
import {
  MoreOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import PreviewInventoryModal from "./PreviewInventoryModal";
import AddEventModal from "./AddEventModal";
import { useNavigate } from "react-router-dom";
import { INVENTORY_STATUS } from "../../helpers/constants";
import UpdateInventoryModal from "./UpdateInventoryModal";
import routes from "../../helpers/routes";

const InventoryCard = ({ inventory, category, debouncedSearchTerm, id }) => {
  const [openPop, setOpenPop] = useState(false);
  const [open, setOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
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
                      onClick={showModalEdit}
                    >
                      <PlusOutlined />
                      <p className="ml-3">Add Event</p>
                    </div>
                    <div
                      className="flex items-center mt-2 cursor-pointer"
                      onClick={showEditModal}
                    >
                      <EditOutlined />
                      <p className="ml-3">Edit</p>
                    </div>
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
            <p className="text-primaryC text-sm w-40">Batch ID</p>
            <p text-secondryB text-sm>
              :
            </p>
            <p className="text-secondryB text-sm ml-3">{inventory.batchId}</p>
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
            <p className="text-primaryC text-sm w-40">Serial Numbers</p>
            <p text-secondryB text-sm>
              :
            </p>
            <div
              className="flex items-center cursor-pointer ml-3"
              onClick={() => {
                navigate(
                  `${routes.Items.url}?inventoryId=${inventory.address}`,
                  { state: { productName: inventory.name } }
                );
              }}
            >
              <EyeOutlined />
              <p className="text-secondryB text-sm ml-2">View</p>
            </div>
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
      {openEdit && (
        <AddEventModal open={openEdit} handleCancel={handleCancelEdit} inventoryId={inventory.address} productId={inventory.productId} />
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
    </Card>
  );
};

export default InventoryCard;
