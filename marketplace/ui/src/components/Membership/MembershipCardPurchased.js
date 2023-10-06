import React, { useEffect, useState } from "react";
import { useFormik, getIn } from "formik";
import { Card, Popover, Spin, Button } from "antd";
import { MoreOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
// import DeleteProductModal from "./DeleteProductModal";
// import UpdateProductModal from "./UpdateProductModal";
import routes from "../../helpers/routes";
import { useNavigate } from "react-router-dom";
import { useAuthenticateState } from "../../contexts/authentication";
import ListNowModal from "../Membership/ListNowModal";
import * as yup from "yup";
import { actions as membershipActions } from "../../contexts/membership/actions";
import { actions as inventoryActions } from "../../contexts/inventory/actions";
import { useMembershipDispatch } from "../../contexts/membership";

import { INVENTORY_STATUS } from "../../helpers/constants";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";

const MembershipCardPurchased = ({
  user,
  membership,
  categorys,
  debouncedSearchTerm,
  membershipId,
  isPurchasedList
}) => {
  const membershipDispatch = useMembershipDispatch();
  const [state, setState] = useState(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const naviroute = routes.MembershipDetail.url;
  const [visible, setVisible] = useState(false);


  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
  const { isCreateInventorySubmitting, inventories } = useInventoryState();

  const inventoryDispatch = useInventoryDispatch();

  useEffect(() => {
    if (visible) {
      inventoryActions.fetchInventory(inventoryDispatch, '', 0, membership.productId);
    }
  }, [visible])

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
    navigate(`${naviroute.replace(":id", state.membershipAddress)}`, { state: { isCalledFromMembership: true, inventoryId: (state.inventoryAddress !== undefined || state.inventoryAddress !== null) ? state.inventoryAddress : null } });
  }

  const closeListNowModal = () => {
    setVisible(false);
  };

  const openListNowModal = () => {
    setVisible(true);
  };

  const getSchema = (isListNowModalOpen) => {
    return yup.object().shape({
      name: yup.string().required("Membership name is required"),
      price: yup.number().when("isListNowModalOpen", {
        is: () => isListNowModalOpen, // Use a function to evaluate the condition
        then: yup.number().required("Price is required"),
      }),
      quantity: yup.number().when("isListNowModalOpen", {
        is: () => isListNowModalOpen, // Use a function to evaluate the condition
        then: yup.number(),
      }),
    });
  };

  const initialValues = {
    name: "",
    price: "",
    quantity: ""
  };

  const formik = useFormik({
    initialValues: initialValues,
    validationSchema: getSchema(visible),
    setFieldValue: (field, value) => {
      formik.setFieldValue(field, value);
    },
    onSubmit: function (values) {
      handleCreateFormSubmit(values);
    },
    enableReinitialize: true,
  });

  const handleCreateFormSubmit = async (values) => {
    if (user) {
      if (formik.values.price !== "" && inventories) {
        const resalePayload = {
          productAddress: membership.productId,
          inventory: membership.inventoryId,
          updates: {
            pricePerUnit: formik.values.price,
            status: INVENTORY_STATUS.PUBLISHED,
            quantity: 1
          }
        }
        const resaleMembership = await membershipActions.resaleMembership(
          membershipDispatch, resalePayload
        )

        if (resaleMembership) {
          // membership.product_with_inventory = 1;
          formik.resetForm();
        }
        setVisible(false);

      }
    }
  };


  return (
    <>
      {state === null ? (
        <div className="h-screen flex justify-center items-center">
          <Spin />
        </div>
      ) : (
        <Card className="w-full mt-6" id="product" key={membershipId}>
          <div className="flex">
            <div className="text-center py-1 rounded w-24 text-sm mt-2.5">
              <img
                className="w-52 object-cover"
                alt=""
                src={membership.productImageLocation}
              />
              {/* {membership.product_with_inventory ?
                (membership.isInventoryAvailable ?
                  (<Button type="primary" shape="round" style={{ background: "green", marginTop: "10px" }}> For Sale </Button>)
                  : (<Button type="primary" shape="round" style={{ background: "red", marginTop: "10px" }}> Retained </Button>))
                : (<Button type="primary" shape="round" style={{ background: "blue", marginTop: "10px" }}> Not for Sale </Button>)} */}
              {membership?.status == 1 && <Button type="primary" shape="round" style={{ background: "blue", marginTop: "10px" }}> For Sale </Button>}
              {membership?.status == 2 && <Button type="primary" shape="round" style={{ background: "blue", marginTop: "10px" }}> Not for Sale </Button>}
            </div>
            <div className="ml-12 w-full">
              <div className="flex justify-between items-center">
                <div className="flex items-center">
                  <h3 className="font-semibold text-primaryB text-xl">
                    {decodeURIComponent(membership.productName)}
                  </h3>
                </div>
                <div className="flex items-center">
                  {(!membership.product_with_inventory && isPurchasedList) ?
                    <Button type="text"
                      className="text-primary text-sm cursor-pointer"
                      onClick={() => {
                        if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                          window.location.href = loginUrl;
                        } else {
                          formik.setFieldValue("name", membership.productName);
                          openListNowModal();
                        }
                      }}
                    >
                      List for Sale
                    </Button>
                    : null}
                  <Button type="text"
                    className="text-primary text-sm cursor-pointer"
                    onClick={callDetailPage}
                  >
                    Preview
                  </Button>

                  {/* <Popover
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
                </Popover> */}
                </div>
              </div>
              <div className="flex mt-1.5 items-center">
                <p className="text-primaryC text-sm w-40">Sub Category</p>
                <p text-secondryB text-sm>
                  :
                </p>
                <p className="text-secondryB text-sm ml-3">
                  {membership.subCategory}
                </p>
              </div>
              <div className="flex mt-1.5 items-center">
                <p className="text-primaryC text-sm w-40">Company Name</p>
                <p text-secondryB text-sm>
                  :
                </p>
                <p className="text-secondryB text-sm ml-3">
                  {membership.manufacturer}
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
              <div className="flex mt-1.5 items-center">
                <p className="text-primaryC text-sm w-40">
                  Savings
                </p>
                <p text-secondryB text-sm>
                  :
                </p>
                <p style={{ color: "green" }} className="text-primaryB font-bold text-sm ml-3">
                  $ {membership.savings}
                </p>
              </div>
              <div className="flex mt-1.5 items-center">
                <p className="text-primaryC text-sm w-40">Membership ID</p>
                <p text-secondryB text-sm>
                  :
                </p>
                <p className="text-secondryB text-sm ml-3">
                  {membershipId}
                </p>
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
      {visible && (
        <ListNowModal
          open={visible}
          user={user}
          handleCancel={closeListNowModal}
          onClick={openListNowModal}
          formik={formik}
          type="Resale"
          id={membershipId}
          getIn={getIn}
          isCreateMembershipSubmitting={isCreateInventorySubmitting}
        />
      )}
    </>
  );
};

export default MembershipCardPurchased;