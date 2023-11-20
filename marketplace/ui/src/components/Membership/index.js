import React, { useState, useEffect } from "react";
import { useLocation, useParams } from "react-router-dom";
// Components
import CreateMembershipModal from "./CreateMembershipModal";
import BreadCrumbComponent from "../BreadCrumb/BreadCrumbComponent";
// Actions
import { actions as membershipActions } from "../../contexts/membership/actions";
import { actions as inventoryActions } from "../../contexts/inventory/actions";
// import { actions as categoryActions } from "../../contexts/category/actions";
// States and Dispatch
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { useMembershipDispatch, useMembershipState } from "../../contexts/membership";
// import { useCategoryDispatch, useCategoryState } from "../../contexts/category";
// import { useSubCategoryState } from "../../contexts/subCategory";
import { useAuthenticateState } from "../../contexts/authentication";
// Assets, Utils
import useDebounce from "../UseDebounce";
import "./membership.css";
import MembershipListTabComponent from "./components/MembershipListTabComponent";
import MembershipHeader from "./components/MembershipHeader";
import ToastComponent from "../ToastComponent/ToastComponent";

const limit = 10, offset = 0, queryValue = "";

const Membership = (user) => {
  const { type } = useParams();
  let { state } = useLocation();

  const isPurchased = type === "purchased";
  const isIssued = type === "issued";
  const isOpen = (state && user.user && state.isCalledFromHeader && isPurchased) ?? false;

  const [open, setOpen] = useState(isOpen);

  // Dispatch
  const membershipDispatch = useMembershipDispatch();
  // const categoryDispatch = useCategoryDispatch();
  const inventoryDispatch = useInventoryDispatch();

  const debouncedSearchTerm = useDebounce(queryValue, 1000);

  // States
  // const { categorys, isCategorysLoading } = useCategoryState();
  // const { subCategorys, isSubCategorysLoading } = useSubCategoryState();
  const { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
  const inventoryState = useInventoryState();
  const {
    memberships,
    isMembershipsLoading,
    isIssuedMembershipLoading,
    isPurchasedMembershipLoading,
    purchasedMemberships,
    message,
    success
  } = useMembershipState();

  // useEffect(() => {
  //   categoryActions.fetchCategories(categoryDispatch);
  // }, []);

  useEffect(() => {
    if (isPurchased) {
      membershipActions.fetchPurchasedMemberships(membershipDispatch)
    }
    if (isIssued) {
      membershipActions.fetchMembership(membershipDispatch);
    }
  }, [type]);

  useEffect(() => {
    if (user?.user?.organization) {
      membershipActions.sellerStripeStatus(membershipDispatch, user?.user?.organization);
    }
  }, [user?.user?.organization]);

  const isRedirectLogin = hasChecked && !isAuthenticated && loginUrl !== undefined

  const showModal = () => {
    isRedirectLogin
      ? (window.location.href = loginUrl)
      : setOpen(true);
  };

  const handleCancel = (message) => {
    if (message === "success") {
      membershipActions.fetchMembership(membershipDispatch, limit, offset, debouncedSearchTerm);
    }

    setOpen(false);
  };

  const handleToastClose = () => {
    membershipActions.resetMessage(membershipDispatch);
    inventoryActions.resetMessage(inventoryDispatch);
  }

  let msg = message || inventoryState.message;

  const isMembershipFound = isMembershipsLoading || isIssuedMembershipLoading || isPurchasedMembershipLoading;
  const listTabProps = { type, isPurchased, user, debouncedSearchTerm }
  return (
    <>
      <div className="min-h-full">
        <BreadCrumbComponent />
        <MembershipHeader
          type={type}
          isMembershipFound={isMembershipFound}
          purchasedMemberships={purchasedMemberships}
          memberships={memberships}
          isPurchased={isPurchased}
          showModal={() => { showModal() }}
        />
        <MembershipListTabComponent
          props={listTabProps} />
      </div>
      {open && (
        <CreateMembershipModal
          open={open}
          user={user}
          handleCancel={handleCancel}
        />
      )}
      {msg && <ToastComponent
        message={msg}
        success={success || inventoryState.success}
        onClose={handleToastClose}
        placement="bottom"
      />}
    </>
  );
};

export default Membership;
