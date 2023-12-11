import React, { useState } from "react";
import { Card, Popover, Button } from "antd";
import {
  DollarOutlined,
  MoreOutlined,
  EditOutlined,
  FormOutlined,
  PieChartOutlined,
  StopOutlined
} from "@ant-design/icons";
import PreviewInventoryModal from "./PreviewInventoryModal";
import AddEventModal from "./AddEventModal";
import { useNavigate } from "react-router-dom";
import UpdateInventoryModal from "./UpdateInventoryModal";
import ListForSaleModal from "./ListForSaleModal";
import UnlistModal from "./UnlistModal";
import ResellModal from "./ResellModal";
import routes from "../../helpers/routes";
import image_placeholder from "../../images/resources/image_placeholder.png";

const InventoryCard = ({ inventory, category, debouncedSearchTerm, id, paymentProviderAddress }) => {
  const [openPop, setOpenPop] = useState(false);
  const [open, setOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [listModalOpen, setListModalOpen] = useState(false);
  const [unlistModalOpen, setUnlistModalOpen] = useState(false);
  const [resellModalOpen, setResellModalOpen] = useState(false);
  const navigate = useNavigate();
  const naviroute = routes.InventoryDetail.url;

  const itemData = JSON.parse(inventory.data);

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

  const showListModal = () => {
    hide();
    setListModalOpen(true);
  };

  const handleListModalClose = () => {
    setListModalOpen(false);
  };

  const showUnlistModal = () => {
    hide();
    setUnlistModalOpen(true);
  };

  const handleUnlistModalClose = () => {
    setUnlistModalOpen(false);
  };

  const showResellModal = () => {
    hide();
    setResellModalOpen(true);
  };

  const handleResellModalClose = () => {
    setResellModalOpen(false);
  };

  const callDetailPage = () => {
    navigate(`${naviroute.replace(":id", inventory.address)}`, {
      state: { isCalledFromInventory: true },
    });
  };

  const getCategory = () => {
    return inventory.category;
  };

  const categoricalProperties = () => {
    switch (getCategory()) {
      case "Art":
        return (
          <div>
            <div className="flex mt-1.5 items-center">
              <p className="text-primaryC text-sm w-40">Artist</p>
              <p text-secondryB text-sm>
                :
              </p>
              <p className="text-secondryB text-sm ml-3">{itemData.artist}</p>
            </div>
          </div>
        );
      case "Carbon":
        return (
          <>
            {/* <div className="flex mt-1.5 items-center">
              <p className="text-primaryC text-sm w-40">Project Type</p>
              <p text-secondryB text-sm>
                :
              </p>
              <p className="text-secondryB text-sm ml-3">
                {itemData.projectType}
              </p>
            </div> */}
            <div className="flex mt-1.5 items-center">
              <p className="text-primaryC text-sm w-40">Quantity Owned</p>
              <p text-secondryB text-sm>
                :
              </p>
              <p className="text-secondryB text-sm ml-3">{inventory.quantity}</p>
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
          </>
        );
      case "Clothing":
        return (
          <div>
            <div className="flex mt-1.5 items-center">
              <p className="text-primaryC text-sm w-40">Brand</p>
              <p text-secondryB text-sm>
                :
              </p>
              <p className="text-secondryB text-sm ml-3">{itemData.brand}</p>
            </div>
            <div className="flex mt-1 items-center">
              <p className="text-primaryC text-sm w-40">Condition</p>
              <p text-secondryB text-sm>
                :
              </p>
              <p className="text-secondryB text-sm ml-3">
                {itemData.condition?.toUpperCase()}
              </p>
            </div>
            <div className="flex mt-1 items-center">
              <p className="text-primaryC text-sm w-40">SKU</p>
              <p text-secondryB text-sm>
                :
              </p>
              <p className="text-secondryB text-sm ml-3">
                {itemData.skuNumber ? itemData.skuNumber : "No SKU Available"}
              </p>
            </div>
          </div>
        );
      case "Metals":
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
      case 'Membership':
        return (
          <>
            <div className="flex mt-1.5 items-center">
              <p className="text-primaryC text-sm w-40">Units</p>
              <p text-secondryB text-sm>
                :
              </p>
              <p className="text-secondryB text-sm ml-3">
                {inventory.quantity}
              </p>
            </div>
          </>
        )
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
              <p className="font-medium text-secondryB text-base ml-2">
                ({getCategory()})
              </p>
              {itemData.isMint && itemData.isMint == 'True' ? (<div className="flex ml-2">
                <div className="text-primary bg-[#EBFFF7] text-center py-1 rounded w-20 text-xs">
                  <p>RESELLABLE</p>
                </div>
              </div>) : (<div></div>)}
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
                    <div
                      className="flex items-center mt-2 cursor-pointer"
                      onClick={showEditModal}
                    >
                      <FormOutlined />
                      <p className="ml-3">Edit Inventory</p>
                    </div>
                    {inventory.price ? (<div>
                      <div
                        className="flex items-center mt-2 cursor-pointer"
                        onClick={showListModal}
                      >
                        <EditOutlined />
                        <p className="ml-3">Edit Listing</p>
                      </div>
                      <div
                        className="flex items-center mt-2 cursor-pointer"
                        onClick={showUnlistModal}
                      >
                        <StopOutlined />
                        <p className="ml-3">Cancel Listing</p>
                      </div>
                    </div>) : paymentProviderAddress ? (<div
                      className="flex items-center mt-2 cursor-pointer"
                      onClick={showListModal}
                    >
                      <DollarOutlined />
                      <p className="ml-3">List for Sale</p>
                    </div>) : (<div></div>)}
                    {itemData.isMint && itemData.isMint == 'True' ? (<div
                      className="flex items-center mt-2 cursor-pointer"
                      onClick={showResellModal}
                    >
                      <PieChartOutlined />
                      <p className="ml-3">Resell</p>
                    </div>) : (<div></div>)}
                  </div>
                }
                trigger="click"
              >
                <MoreOutlined />
              </Popover>
            </div>
          </div>
          {categoricalProperties()}
          { inventory.price ? 
            <div className="flex mt-1 items-center">
              <p className="text-primaryC text-sm w-40">Price</p>
              <p text-secondryB text-sm>
                :
              </p>
              <p className="text-secondryB text-sm ml-3">
                ${inventory.price}
              </p>
            </div> : <></>
          }
          { inventory.saleQuantity ? 
            <div className="flex mt-1 items-center">
              <p className="text-primaryC text-sm w-40">Quantity for Sale</p>
              <p text-secondryB text-sm>
                :
              </p>
              <p className="text-secondryB text-sm ml-3">
                {inventory.saleQuantity}
              </p>
            </div> : <></>
          }
          <div className="flex mt-1 items-center">
            <p className="text-primaryC text-sm w-40">Description</p>
            <p text-secondryB text-sm>
              :
            </p>
            <p className="text-secondryB text-sm ml-3">
              {inventory.description}
            </p>
          </div>
          { inventory.price ?
            (<div className="flex mt-2.5">
              <div className="text-primary bg-[#EBF7FF] text-center py-1 rounded w-28 text-sm">
                <p>PUBLISHED</p>
              </div>
            </div>)
            :
            (<div className="flex mt-2.5">
              <div className="text-error bg-[#FFF0F0] text-center py-1 rounded w-28 text-sm">
                <p>UNPUBLISHED</p>
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
      {listModalOpen && (
        <ListForSaleModal
          open={listModalOpen}
          handleCancel={handleListModalClose}
          inventory={inventory}
          paymentProviderAddress={paymentProviderAddress}
        />
      )}
      {unlistModalOpen && (
        <UnlistModal
          open={unlistModalOpen}
          handleCancel={handleUnlistModalClose}
          inventory={inventory}
          saleAddress={inventory.saleAddress}
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

}

export default InventoryCard;
