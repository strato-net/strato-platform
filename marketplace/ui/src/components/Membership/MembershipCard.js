import React, { useEffect, useState } from "react";
import classNames from "classnames";
import { Card, Popover, Spin, Button } from "antd";
import { MoreOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
// import DeleteProductModal from "./DeleteProductModal";
// import UpdateProductModal from "./UpdateProductModal";
import { UNIT_OF_MEASUREMENTS } from "../../helpers/constants";
import routes from "../../helpers/routes";
import { useNavigate } from "react-router-dom";

const MembershipCard = ({
  membership,
  categorys,
  debouncedSearchTerm,
}) => {
  const [state, setState] = useState(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const naviroute = routes.MembershipDetail.url;

  const showModal = () => {
    hide();
    setOpen(true);
  };

  const handleCancel = () => {
    setOpen(false);
  };

  const [openPop, setOpenPop] = useState(false);
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

  useEffect(() => {
    setState(membership);
  }, [membership]);

  
  const callDetailPage = () => {
    navigate(`${naviroute.replace(":id", state.address)}`, { state: { isCalledFromMembership: true } });
  }


  return (
    <>
      {state === null ? (
        <div className="h-screen flex justify-center items-center">
          <Spin />
        </div>
      ) : (
        <Card className="w-full mt-6" id="product">
          <div className="flex">
            <img
              className="w-52 object-cover"
              alt=""
              src={membership.productImage1}
            />
            <div className="ml-12 w-full">
              <div className="flex justify-between items-center">
                <div className="flex items-center">
                  <h3 className="font-semibold text-primaryB text-xl">
                    {decodeURIComponent(membership.product.name)}
                  </h3>
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
                  onOpenChange={handleOpenChange}
                  title={
                    <div className="font-medium">
                      <div
                        className="flex items-center cursor-pointer"
                        onClick={showEditModal}
                        id="edit-button"
                      >
                        <EditOutlined />
                        <p className="ml-3">Edit</p>
                      </div>
                      <div
                        className="flex items-center mt-2 cursor-pointer"
                        onClick={showModal}
                        id="delete-button"
                      >
                        <DeleteOutlined />
                        <p className="ml-3">Delete</p>
                      </div>
                    </div>
                  }
                  trigger="click"
                >
                  <MoreOutlined />
                </Popover>
                </div>
              </div>
              <div className="flex mt-1.5 items-center">
                <p className="text-primaryC text-sm w-40">Sub Category</p>
                <p text-secondryB text-sm>
                  :
                </p>
                <p className="text-secondryB text-sm ml-3">
                  {membership.product.subCategory}
                </p>
              </div>
              <div className="flex mt-1.5 items-center">
                <p className="text-primaryC text-sm w-40">Company Name</p>
                <p text-secondryB text-sm>
                  :
                </p>
                <p className="text-secondryB text-sm ml-3">
                  {membership.product.manufacturer}
                </p>
              </div>
              <div className="flex mt-1.5 items-center">
                <p className="text-primaryC text-sm w-40">
                  Duration
                </p>
                <p text-secondryB text-sm>
                  :
                </p>
                <p className="text-secondryB text-sm ml-3">
                 {membership.timePeriodInMonths} Month(s)
                </p>
              </div>
              <div className={classNames( "text-center py-1 rounded w-24 text-sm mt-2.5")}>
                {membership.product_with_inventory ?  
                  (membership.isInventoryAvailable ?
                      (<Button type="primary" shape="round"  size={1} style={{ background: "green" }}> Active </Button>) 
                      : (<Button type="primary" shape="round"  size={1} style={{ background: "red" }}> Retained </Button>) )
                  :(<Button type="primary" shape="round"  size={1} style={{ background: "blue"    }}> Prepared </Button>)}
              </div>
            </div>
          </div>
          {/* {open && (
            <DeleteProductModal
              open={open}
              handleCancel={handleCancel}
              product={state}
              debouncedSearchTerm={debouncedSearchTerm}
            />
          )}
          {editModalOpen && (
            <UpdateProductModal
              open={editModalOpen}
              handleCancel={handleEditModalClose}
              productToUpdate={state}
              categorys={categorys}
              debouncedSearchTerm={debouncedSearchTerm}
            />
          )} */}
        </Card>
      )}
    </>
  );
};

export default MembershipCard;