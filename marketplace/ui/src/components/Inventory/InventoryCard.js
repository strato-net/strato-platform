import React, { useState } from "react";
import classNames from "classnames";
import { Card, Popover, Button, Spin } from "antd";
import {
  MoreOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  PieChartOutlined
} from "@ant-design/icons";
import PreviewInventoryModal from "./PreviewInventoryModal";
import AddEventModal from "./AddEventModal";
import { useNavigate } from "react-router-dom";
import { UNIT_OF_MEASUREMENTS, INVENTORY_STATUS } from "../../helpers/constants";
import UpdateInventoryModal from "./UpdateInventoryModal";
import ResellModal from "./ResellModal";
import routes from "../../helpers/routes";
import image_placeholder from "../../images/resources/image_placeholder.png";
import { actions } from "../../contexts/inventory/actions";
import {
  useInventoryDispatch,
  useInventoryState,
} from "../../contexts/inventory";

const InventoryCard = ({ inventory, category, debouncedSearchTerm, id }) => {
  const [openPop, setOpenPop] = useState(false);
  const [open, setOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [resellModalOpen, setResellModalOpen] = useState(false);
  const navigate = useNavigate();
  const naviroute = routes.InventoryDetail.url;

  const itemData = JSON.parse(inventory.data);
  
  // Dispatch
  const dispatch = useInventoryDispatch();
  
  // State
  const { isinventoryUpdating } = useInventoryState();
  
  
  // Actions
  const unpublishInventory = async (inventory) => {
    try {
      const body = {
        itemContract: inventory.contract_name.split('-')[1],
        itemAddress: inventory.address,
        updates: {
          price: inventory.price,
          status: INVENTORY_STATUS.UNPUBLISHED,
        },
      };
      console.log("body", body);
      const res = await actions.updateInventory(dispatch, body);
      if (res) {
        actions.fetchInventory(dispatch, 10, 0, debouncedSearchTerm);
      }
    } catch (error) {
      console.log(error);
    }
  };

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

  const getCategory = () => {
    const parts = inventory.contract_name.split('-');
    return parts[parts.length - 1];
  };

  const categoricalProperties = () => {
    switch (getCategory()) {
      case 'Art':
        return (
          <div className="flex mt-1.5 items-center">
            <p className="text-primaryC text-sm w-40">Artist</p>
            <p text-secondryB text-sm>
              :
            </p>
            <p className="text-secondryB text-sm ml-3">
              {itemData.artist}
            </p>
          </div>)
      case 'Carbon':
        return (
          <>
            <div className="flex mt-1.5 items-center">
              <p className="text-primaryC text-sm w-40">Project Type</p>
              <p text-secondryB text-sm>
                :
              </p>
              <p className="text-secondryB text-sm ml-3">
                {itemData.projectType}
              </p>
            </div>
            <div className="flex mt-1.5 items-center">
              <p className="text-primaryC text-sm w-40">Units</p>
              <p text-secondryB text-sm>
                :
              </p>
              <p className="text-secondryB text-sm ml-3">
                {itemData.units}
              </p>
            </div>
          </>
          )
      case 'Clothing':
        return (
          <div className="flex mt-1.5 items-center">
            <p className="text-primaryC text-sm w-40">Brand</p>
            <p text-secondryB text-sm>
              :
            </p>
            <p className="text-secondryB text-sm ml-3">
              {itemData.brand}
            </p>
          </div>)
      case 'Metals':
        return (
          <div className="flex mt-1.5 items-center">
            <p className="text-primaryC text-sm w-40">Source</p>
            <p text-secondryB text-sm>
              :
            </p>
            <p className="text-secondryB text-sm ml-3">
              {itemData.source}
            </p>
          </div>)
      default:
        break;
    }
  };

  return (
    <Card className="w-full mt-6">
      <div className="flex" id={id}>
        <img
          className="w-52 object-contain"
          alt=""
          src={
            inventory.images && inventory.images.length > 0
              ? inventory.images[0]
              : image_placeholder
          }
        />
        <div className="ml-12 w-full">
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <h3 className="font-semibold text-primaryB text-xl">
                {decodeURIComponent(inventory.name)}
              </h3>
              {
                <p className="font-medium text-secondryB text-base ml-2">
                  ({getCategory()})
                </p>
              }
            </div>
            <div className="flex items-center">
              <Button
                type="text"
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
                    {inventory.status === "2" ? (
                      <div
                        className="flex items-center mt-2 cursor-pointer"
                        onClick={showResellModal}
                      >
                        <PieChartOutlined />
                        <p className="ml-3">Resell</p>
                      </div>
                    ) : (
                      <>
                        <div
                          className="flex items-center mt-2 cursor-pointer"
                          onClick={showEditModal}
                        >
                          <EditOutlined />
                          <p className="ml-3">Edit</p>
                        </div>
                        <div
                          className={`flex items-center mt-2 cursor-pointer ${isinventoryUpdating ? 'disabled' : ''}`}
                          onClick={() => unpublishInventory(inventory)}
                          style={{ opacity: isinventoryUpdating ? 0.5 : 1 }}
                        >
                          {isinventoryUpdating ? <Spin /> : <PieChartOutlined />}
                          <p className="ml-3">Unpublish</p>
                        </div>
                      </>
                    )}
                  </div>
                }
                trigger="click"
              >
                <MoreOutlined />
              </Popover>
            </div>
          </div>
          {categoricalProperties()}
          {inventory.status === "2" ? (
            <></>
          ) : (
            <div className="flex mt-1 items-center">
              <p className="text-primaryC text-sm w-40">Price</p>
              <p text-secondryB text-sm>
                :
              </p>
              <p className="text-secondryB text-sm ml-3">$ {inventory.price}</p>
            </div>
          )}
          <div className="flex mt-1 items-center">
            <p className="text-primaryC text-sm w-40">Description</p>
            <p text-secondryB text-sm>
              :
            </p>
            <p className="text-secondryB text-sm ml-3">
              {inventory.description}
            </p>
          </div>
          <div className="flex mt-1 items-center">
            <p className="text-primaryC text-sm w-40">Serial Number</p>
            <p text-secondryB text-sm>
              :
            </p>
            <p className="text-secondryB text-sm ml-3">
              {itemData.serialNumber
                ? itemData.serialNumber
                : "No Serial Number Available"}
            </p>
          </div>
          {inventory.status === "2" ? (
            <div className="flex mt-2.5">
              <div className="text-error bg-[#FFF0F0] text-center py-1 rounded w-28 text-sm">
                <p>UNPUBLISHED</p>
              </div>
            </div>
          ) : (
            <div className="flex mt-2.5">
              <div className="text-primary bg-[#EBF7FF] text-center py-1 rounded w-28 text-sm">
                <p>PUBLISHED</p>
              </div>
            </div>
          )}
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
        <AddEventModal
          open={openEdit}
          handleCancel={handleCancelEdit}
          inventoryId={inventory.address}
          productId={inventory.productId}
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
