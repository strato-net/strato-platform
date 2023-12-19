import React, { useState } from "react";
import { Card, Popover, Button } from "antd";
import {
  DollarOutlined,
  MoreOutlined,
  EditOutlined,
  FormOutlined,
  PieChartOutlined,
  StopOutlined,
  SwapOutlined
} from "@ant-design/icons";
import PreviewInventoryModal from "./PreviewInventoryModal";
import AddEventModal from "./AddEventModal";
import { Navigate, useNavigate } from "react-router-dom";
import UpdateInventoryModal from "./UpdateInventoryModal";
import ListForSaleModal from "./ListForSaleModal";
import UnlistModal from "./UnlistModal";
import ResellModal from "./ResellModal";
import TransferModal from "./TransferModal";
import routes from "../../helpers/routes";
import { Carousel } from "react-responsive-carousel";
import image_placeholder from "../../images/resources/image_placeholder.png";
import { getUnitNameByIndex } from "../../helpers/constants";
import "react-responsive-carousel/lib/styles/carousel.min.css";

const InventoryCard = ({ inventory, category, debouncedSearchTerm, id, paymentProviderAddress }) => {
  const [openPop, setOpenPop] = useState(false);
  const [open, setOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [openEdit, setOpenEdit] = useState(false);
  const [listModalOpen, setListModalOpen] = useState(false);
  const [unlistModalOpen, setUnlistModalOpen] = useState(false);
  const [resellModalOpen, setResellModalOpen] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
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

  const showTransferModal = () => {
    hide();
    setTransferModalOpen(true);
  };

  const handleTransferModalClose = () => {
    setTransferModalOpen(false);
  };

  const callDetailPage = () => {
    navigate(`${naviroute.replace(":id", inventory.address)}`, {
      state: { isCalledFromInventory: true },
    });
  };

  const getCategory = () => {
    const parts = inventory.contract_name.split('-');
    return parts[parts.length - 1];
  };

  const categoricalProperties = () => {
    switch (getCategory()) {
      case "Art":
        return (
          <div>
            <div className="flex mt-1.5 items-center">
              <p className="text-primaryC text-sm w-40">Artist</p>
              <p className="text-secondryB text-sm">
                :
              </p>
              <p className="text-secondryB text-sm ml-3">{itemData.artist}</p>
            </div>
          </div>
        );
      // case "Carbon":
      //   return (
      //     <>
      //       <div className="flex mt-1.5 items-center">
      //         <p className="text-primaryC text-sm w-40">Quantity Owned</p>
      //         <p className="text-secondryB text-sm">
      //           :
      //         </p>
      //         <p className="text-secondryB text-sm ml-3">{inventory.quantity}</p>
      //       </div>
      //     </>
      //   );
      case "Clothing":
        return (
          <div>
            <div className="flex mt-1.5 items-center">
              <p className="text-primaryC text-sm w-40">Brand</p>
              <p className="text-secondryB text-sm">
                :
              </p>
              <p className="text-secondryB text-sm ml-3">{itemData.brand}</p>
            </div>
            <div className="flex mt-1 items-center">
              <p className="text-primaryC text-sm w-40">Condition</p>
              <p className="text-secondryB text-sm">
                :
              </p>
              <p className="text-secondryB text-sm ml-3">
                {itemData.condition?.toUpperCase()}
              </p>
            </div>
            <div className="flex mt-1 items-center">
              <p className="text-primaryC text-sm w-40">SKU</p>
              <p className="text-secondryB text-sm">
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
          <>
          <div className="flex mt-1.5 items-center">
              <p className="text-primaryC text-sm w-40">Purity</p>
              <p text-secondryB text-sm>
                :
              </p>
              <p className="text-secondryB text-sm ml-3">
                {itemData.purity}
              </p>
            </div>
            <div className="flex mt-1.5 items-center">
              <p className="text-primaryC text-sm w-40">Unit Of Measurement</p>
              <p text-secondryB text-sm>
                :
              </p>
              <p className="text-secondryB text-sm ml-3">
              {getUnitNameByIndex(itemData.unitOfMeasurement)}
       
                
              </p>
            </div>
          <div className="flex mt-1.5 items-center">
            <p className="text-primaryC text-sm w-40">Source</p>
            <p className="text-secondryB text-sm">
              :
            </p>
            <p className="text-secondryB text-sm ml-3">
              {itemData.source}
            </p>
          </div>
          </>)
      case 'Membership':
        return (
          <>
            <div className="flex mt-1.5 items-center">
              <p className="text-primaryC text-sm w-40">Units</p>
              <p className="text-secondryB text-sm">
                :
              </p>
              <p className="text-secondryB text-sm ml-3">
                {itemData.units}
              </p>
            </div>
          </>
        )
      // case "CarbonDAO":
      //   return (
      //     <>
      //       <div className="flex mt-1.5 items-center">
      //         <p className="text-primaryC text-sm w-40">Quantity</p>
      //         <p className="text-secondryB text-sm">
      //           :
      //         </p>
      //         <p className="text-secondryB text-sm ml-3">
      //           {inventory.quantity}
      //         </p>
      //       </div>
      //     </>
      //   )
      default:
        break;
    }
  };

/*
                    <div
                      className="flex items-center mt-2 cursor-pointer"
                      onClick={showEditModal}
                    >
                      <FormOutlined />
                      <p className="ml-3">Edit Inventory</p>
                    </div>
*/


  return (
<div className="mt-6 p-[18px] border border-[#E9E9E9] rounded-lg  ">
          <div className="bg-[#F2F2F9] rounded-md px-[14px] pb-[13px] pt-2 w-full">
            <p className="text-xl font-semibold text-[#202020]">{inventory?.name  || "N/A"}</p>
            <div className=" lg:justify-between justify-end pt-[5px]  flex">
              <div className="hidden lg:block ">
              <p className="text-xs text-[#6A6A6A]">{ inventory?.description || "N/A" }</p>
              </div> 
               <Popover
                placement="bottomLeft"
                open={openPop}
                className="ml-2"
                id="sideMenu"
                onOpenChange={handleOpenChange}
                title={
                  <div className="font-medium">
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
                        <p className="ml-3">Unlist</p>
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
                      <p className="ml-3">Mint</p>
                    </div>) : (<div></div>)}
                    <div
                      className="flex items-center mt-2 cursor-pointer"
                      onClick={showTransferModal}
                    >
                      <SwapOutlined />
                      <p className="ml-3">Transfer</p>
                    </div>
                  </div>
                }
                trigger="click"
              >
                <MoreOutlined />
              </Popover>
            </div>
          </div>
        <div className="pt-[14px] flex md:flex-row  flex-col items-center gap-y-4 md:gap-[18px]">
        
            {/* <Carousel className="w-[161px] h-[161px] inventory rounded-md">
            <div>
            <img 
          className="rounded-md object-contain w-[161px] h-[161px] "
          alt=""
          src={
            inventory.images && inventory.images.length > 0
              ? inventory.images[0]
              : image_placeholder }
        />
          </div> <div>
            <img 
          className="rounded-md object-contain w-[161px] h-[161px] "
          alt=""
          src={
            inventory.images && inventory.images.length > 0
              ? inventory.images[0]
              : image_placeholder }
        />
          </div> 
            </Carousel> */}
            <div>
            <img 
          className="rounded-md object-contain w-[161px] h-[161px] "
          alt=""
          src={
            inventory.images && inventory.images.length > 0
              ? inventory.images[0]
              : image_placeholder }
        />
          </div>
          <div className="pt-[7px] lg:hidden flex items-center gap-[5px]">
          <div className="w-[10px] h-[10px] rounded-sm bg-[#119B2D]"></div>
          <p className="text-[#4D4D4D] text-xs">PUBLISHED</p>
        </div>
          <div className="pt-5 w-full lg:hidden">
          <p className="text-xs text-[#6A6A6A]">{inventory?.description || "N/A"}</p>
          </div>
        <div className="flex flex-col gap-4 px-[18px] py-4 border border-[#E9E9E9] rounded-md w-full ">
        <div className="flex justify-between  ">
          <p className="text-[#6A6A6A]">Sub Category</p>
             <p className="text-[#202020] font-medium">{inventory.subCategory || "N/A"}</p>
        </div> <div className="flex justify-between  ">
          <p className="text-[#6A6A6A]">Quantity Owned</p>
             <p className="text-[#202020] font-medium">{inventory.quantity || "N/A"}</p>
        </div> <div className="flex justify-between  ">
          <p className="text-[#6A6A6A]">Quantity for Sale </p>
             <p className="text-[#202020] font-medium">{inventory.saleQuantity || "N/A"}</p>
        </div>
         <div className="flex justify-between  ">
          <p className="text-[#6A6A6A]">Price</p>
             <p className="text-[#202020] font-medium">{inventory?.price || "N/A"}</p>
        </div>
       
          </div>

        </div>
        <div className="flex justify-between">
        <div className="pt-[7px] hidden lg:flex items-center gap-[5px]">
          <div className="w-[10px] h-[10px] rounded-sm bg-[#119B2D]"></div>
          <p className="text-[#4D4D4D] text-xs">PUBLISHED</p>
        </div>
             <Button type="link" className="text-[#13188A] font-semibold" onClick={callDetailPage}>preview</Button>
        </div>
      {/* <div className="flex" id={id}>
        <img
          className="w-52 object-contain"
          alt=""
          src={
            inventory.images && inventory.images.length > 0
              ? inventory.images[0]
              : image_placeholder }
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
                <div className="text-primary bg-[#EBFFF7] text-center py-1 rounded w-25 text-s">
                  <p>Original Issuer</p>
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
                        <p className="ml-3">Unlist</p>
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
                      <p className="ml-3">Mint</p>
                    </div>) : (<div></div>)}
                    <div
                      className="flex items-center mt-2 cursor-pointer"
                      onClick={showTransferModal}
                    >
                      <SwapOutlined />
                      <p className="ml-3">Transfer</p>
                    </div>
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
              <p className="text-secondryB text-sm">
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
          { inventory.quantity ? 
            <div className="flex mt-1 items-center">
              <p className="text-primaryC text-sm w-40">Quantity Owned</p>
              <p text-secondryB text-sm>
                :
              </p>
              <p className="text-secondryB text-sm ml-3">
                {inventory.quantity}
              </p>
            </div> : <></>
          }
          <div className="flex mt-1 items-center">
            <p className="text-primaryC text-sm w-40">Description</p>
            <p className="text-secondryB text-sm">
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
      </div> */}
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
      {transferModalOpen && (
        <TransferModal
          open={transferModalOpen}
          handleCancel={handleTransferModalClose}
          inventory={inventory}
        />
      )}
    </div>
  );

}

export default InventoryCard;