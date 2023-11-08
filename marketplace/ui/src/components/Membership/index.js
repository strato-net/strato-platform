import React, { useState, useEffect } from "react";
import { useLocation, useParams } from "react-router-dom";
import { notification, Spin } from "antd";
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

const limit = 10;

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

  const [api, contextHolder] = notification.useNotification();
  const [queryValue, setQueryValue] = useState("");
  const [offset, setOffset] = useState(0);
  const debouncedSearchTerm = useDebounce(queryValue, 1000);

  // States
  // const { categorys, iscategorysLoading } = useCategoryState();
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
    success,
    stripeStatus,
    isLoadingStripeStatus,
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
    } else {
    }
    setOpen(false);
  };

  const handleToastClose = () => {
    membershipActions.resetMessage(membershipDispatch);
    inventoryActions.resetMessage(inventoryDispatch);
  }

  let msg = message || inventoryState.message;
  const openToast = (placement) => {
    if (success || inventoryState.success) {
      api.success({
        message: msg,
        onClose: () => {
          handleToastClose()
        },
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: msg,
        onClose: () => {
          handleToastClose()
        },
        placement,
        key: 2,
      });
    }
  };

  const isPageLoading = stripeStatus === null || isLoadingStripeStatus;
  const isMembershipFound = isMembershipsLoading || isIssuedMembershipLoading || isPurchasedMembershipLoading;

  return (
    <>
      {contextHolder}
      {isPageLoading ? (
        <div className="h-screen flex justify-center items-center mx-auto">
          <Spin spinning={isLoadingStripeStatus} size="large" />
        </div>
      ) : (
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
            props={{
              type,
              isPurchased,
              user,
              // categorys,
              // subCategorys,
              debouncedSearchTerm
            }} />
        </div>
      )}
      {open && (
        <CreateMembershipModal
          open={open}
          user={user}
          handleCancel={handleCancel}
        //   categorys={categorys}
        />
      )}
      {msg && openToast("bottom")}
    </>
  );
};

export default Membership;
