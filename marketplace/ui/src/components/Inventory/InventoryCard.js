import React, { useState } from "react";
import { Card, Popover, Button, Typography, Tooltip } from "antd";
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
import { SEO } from "../../helpers/seoConstant";

const InventoryCard = ({ inventory, category, debouncedSearchTerm, id, paymentProviderAddress, allSubcategories, limit, offset }) => {
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
  const imgMeta = category ? category : SEO.TITLE_META
  
  const itemData = inventory.data;
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
    const contractName = parts[parts.length - 1];
   
    return allSubcategories?.find(c => c.contract === contractName)?.name
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
    <div className=" p-3 md:p-[18px] border border-[#BABABA] md:border-[#E9E9E9] rounded-lg sm:w-[343px] md:w-full  ">
      <div className="bg-[#F2F2F9] rounded-md px-[14px] flex justify-between items-center pb-[13px] pt-2 w-full">
        <div>
          <p className="text-lg lg:text-xl font-semibold text-[#202020] cursor-default" onClick={callDetailPage}>
            {/* {inventory?.name || "N/A"} */}
            <Tooltip title={inventory?.name.length > 20 ? inventory?.name : null}>
              <span className=" whitespace-nowrap max-w-[160px] inline-block">
                {
                  inventory?.groupedAssets.length > 1 ? 
                  // TODO: Add in the proper link here for the new gropued asset table. This should redirect to this new page if there are grouped assets. 
                  ( 
                    <a>
                      {inventory?.name.length > 20 ? `${inventory?.name.slice(0, 20)}... (${inventory.groupedAssets.length})` : `${inventory?.name} (${inventory.groupedAssets.length})`}
                    </a>
                  ) : inventory?.name.length > 20 ? `${inventory?.name.slice(0, 20)}...` : `${inventory?.name}`
                }
                
              </span>
            </Tooltip>
          </p>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <Typography className="pt-1">{`(${getCategory()})`}</Typography>
            {inventory?.contract_name.toLowerCase().includes("clothing") && (
              <Typography className='pt-1'>{'Size: ' + inventory?.data?.size || "N/A"}</Typography>
            )}
          </div>
        </div>
        <div className=" pt-[5px]  flex">
          
          <div className="flex  items-center">
          <Button type="link" className="text-[#13188A] font-semibold text-base h-6 mb-2" onClick={callDetailPage}>Preview</Button>

        {((itemData.isMint === "True" && inventory.quantity === 0) || inventory.quantity > 0) &&
           <Popover
            placement="bottomLeft"
            open={openPop}
            className=""
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
                {itemData.isMint && itemData.isMint == "True" ? (<div
                  className="flex items-center mt-2 cursor-pointer"
                  onClick={showResellModal}
                >
                  <PieChartOutlined />
                  <p className="ml-3">Mint</p>
                </div>) : (<div></div>)}

                {inventory.quantity && parseInt(inventory.quantity) > 0 && (!inventory.saleAddress || (inventory.saleAddress && parseInt(inventory.saleQuantity) > 0)) ? (
                  <div
                      className="flex items-center mt-2 cursor-pointer"
                      onClick={showTransferModal}
                  >
                      <SwapOutlined />
                      <p className="ml-3">Transfer</p>
                  </div>
                ) : (
                  <div></div>
              )}

              </div>
            }
            trigger="click"
          >
            <MoreOutlined />
          </Popover>
          }
          </div>
        </div>
      </div>
      <div className="pt-[14px] flex lg:flex-row  flex-col items-center gap-y-4 md:gap-[18px]">
        <div>
          <img
            className="rounded-md  w-[161px] h-[161px] md:object-contain"
            alt={imgMeta}
            title={imgMeta}
            src={
              inventory.images && inventory.images.length > 0
                ? inventory.images[0]
                : image_placeholder}
                
          />
        </div>


        <div className="pt-[7px] lg:hidden flex items-center gap-[5px]">
        {inventory.price ?
          <div className="flex items-center gap-2 bg-[#1548C329] p-[6px] rounded-md">
            <div className="w-[7px] h-[7px] rounded-full bg-[#119B2D]"></div>
            <p className="text-[#4D4D4D] text-[8px]">Published</p>
          </div>
          :
          (inventory.data.isMint && inventory.data.isMint === "False" && inventory.quantity === 0) || (!inventory.data.isMint && inventory.quantity === 0)?
          <div className="flex items-center gap-2 bg-[#FFA50029] p-[6px] rounded-md">
            <div className="w-[7px] h-[7px] rounded-full bg-[#FFA500]"></div>
            <p className="text-[#4D4D4D] text-[8px]">Sold Out</p>
          </div>
            :  
            <div className="flex items-center gap-2 bg-[#1548C329] p-[6px] rounded-md">
              <div className="w-[7px] h-[7px] rounded-full bg-[#ff4d4f]"></div>
              <p className="text-[#4D4D4D] text-[8px]">Unpublished</p>
            </div>
          }
        </div>


       
        <div className="flex flex-col gap-4 px-[18px] py-4 border border-[#E9E9E9] rounded-md w-full ">
          <div className="flex justify-between  ">
            <p className="text-[#6A6A6A]">Quantity Owned</p>
            <p className="text-[#202020] font-semibold">{inventory.quantity || "N/A"}</p>
          </div> <div className="flex justify-between  ">
            <p className="text-[#6A6A6A]">Quantity Available for Sale </p>
            <p className="text-[#202020] font-semibold">{(inventory.quantity - (inventory.totalLockedQuantity ? inventory.totalLockedQuantity : 0)) || "N/A"}</p>
          </div> <div className="flex justify-between  ">
            <p className="text-[#6A6A6A]">Quantity Listed for Sale</p>
            <p className="text-[#202020] font-semibold">{inventory.saleQuantity || "N/A"}</p>
          </div>
          <div className="flex justify-between  ">
            <p className="text-[#6A6A6A]">Price</p>
            <p className="text-[#202020] font-semibold">{inventory?.price || "N/A"}</p>
          </div>

        </div>

      </div>
      <div className="flex justify-between">
        {inventory.price ?
          <div className="pt-[7px] hidden lg:flex items-center gap-[5px] bg-[#1548C329] p-[6px] rounded-md">
            <div className="w-[10px] h-[10px] rounded-full bg-[#119B2D]"></div>
            <p className="text-[#4D4D4D] text-xs"> Published </p>
          </div>
          :
          (inventory.data.isMint && inventory.data.isMint === "False" && inventory.quantity === 0) || (!inventory.data.isMint && inventory.quantity === 0)?
          <div className="pt-[7px] hidden lg:flex items-center gap-[5px] bg-[#FFA50029] p-[6px] rounded-md">
            <div className="w-[10px] h-[10px] rounded-full bg-[#FFA500]"></div>
            <p className="text-[#4D4D4D] text-xs"> Sold Out </p>
          </div>
            :
            <div className="pt-[7px] hidden lg:flex items-center gap-[5px] bg-[#1548C329] p-[6px] rounded-md">
              <div className="w-[10px] h-[10px] rounded-full bg-[#ff4d4f]"></div>
              <p className="text-[#4D4D4D] text-xs"> Unpublished </p>
            </div>
        }

       
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
          limit={limit}
          offset={offset}
          debouncedSearchTerm={debouncedSearchTerm}
          inventoryToUpdate={{
            inventory: inventory,
            category: category,
          }}
          categoryName={category}
        />
      )}
      {listModalOpen && (
        <ListForSaleModal
          open={listModalOpen}
          handleCancel={handleListModalClose}
          limit={limit}
          offset={offset}
          inventory={inventory}
          paymentProviderAddress={paymentProviderAddress}
          categoryName={category}
        />
      )}
      {unlistModalOpen && (
        <UnlistModal
          open={unlistModalOpen}
          handleCancel={handleUnlistModalClose}
          limit={limit}
          offset={offset}
          inventory={inventory}
          saleAddress={inventory.saleAddress}
          categoryName={category}
        />
      )}
      {resellModalOpen && (
        <ResellModal
          open={resellModalOpen}
          handleCancel={handleResellModalClose}
          limit={limit}
          offset={offset}
          inventory={inventory}
          categoryName={category}
          
        />
      )}
      {transferModalOpen && (
        <TransferModal
          open={transferModalOpen}
          handleCancel={handleTransferModalClose}
          limit={limit}
          offset={offset}
          inventory={inventory}
          categoryName={category}
        />
      )}
    </div>
  );

}

export default InventoryCard;