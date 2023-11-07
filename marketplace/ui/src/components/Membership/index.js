import React, { useState, useEffect } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams } from "react-router-dom";
import { Button, Col, notification, Spin, Typography, Tabs, Row } from "antd";
// Components
import CreateMembershipModal from "./CreateMembershipModal";
import PurchasedList from "./PurchasedList";
import IssuedList from "./IssuedList";
import BreadCrumbComponent from "../BreadCrumb/BreadCrumbComponent";
// Actions
import { actions as membershipActions } from "../../contexts/membership/actions";
import { actions as inventoryActions } from "../../contexts/inventory/actions";
import { actions as categoryActions } from "../../contexts/category/actions";
// States and Dispatch
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import { useMembershipDispatch, useMembershipState } from "../../contexts/membership";
import { useCategoryDispatch, useCategoryState } from "../../contexts/category";
import { useSubCategoryState } from "../../contexts/subCategory";
import { useAuthenticateState } from "../../contexts/authentication";
// Assets, Utils
import useDebounce from "../UseDebounce";
import "./membership.css";
import routes from "../../helpers/routes";
import { createServiceIcon, servicesIcon } from "../../images/SVGComponents";
import { setCookie } from "../../helpers/cookie";


const { Text } = Typography;
const limit = 10;

const Membership = (user) => {
  const navigate = useNavigate();
  const { type } = useParams();
  let { state } = useLocation();

  const isPurchased = type === "purchased";
  const isOpen = (state && user.user && state.isCalledFromHeader && isPurchased) ?? false

  const [open, setOpen] = useState(isOpen);

  // Dispatch
  const membershipDispatch = useMembershipDispatch();
  const categoryDispatch = useCategoryDispatch();
  const inventoryDispatch = useInventoryDispatch();

  const [api, contextHolder] = notification.useNotification();
  const [queryValue, setQueryValue] = useState("");
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(1);
  const debouncedSearchTerm = useDebounce(queryValue, 1000);

  // States
  const { categorys, iscategorysLoading } = useCategoryState();
  const { subCategorys, isSubCategorysLoading } = useSubCategoryState();
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

  useEffect(() => {
    categoryActions.fetchCategories(categoryDispatch);
  }, []);

  const isRedirectLogin = hasChecked && !isAuthenticated && loginUrl !== undefined

  useEffect(() => {
    if (user?.user?.organization) {
      membershipActions.sellerStripeStatus(membershipDispatch, user?.user?.organization);
    }
  }, [user.user]);

  const onboardSeller = async () => {
    navigate(routes.OnboardingSellerToStripe.url);
  };

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

  const onChange = (key) => {
    setCookie("returnUrl", `/marketplace/memberships/${key}`, 10);
    navigate(`/memberships/${key}`)
  };

  const tabItems = [{ key: "purchased", isActive: isPurchased }, { key: "issued", isActive: !isPurchased }]

  const items = tabItems.map((item, index) => {
    return { ...item, label: <Text className="text-xl font-bold leading-6 capitalize" style={{ color: item.isActive ? "#181EAC" : "rgba(0, 0, 0, 0.4)" }}>{item.key}</Text> }
  })

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

          <Col className="mt-2 h-24 py-5 bg-red-800" style={{ backgroundColor: '#F2F2F2' }}>
            <Row className="mx-16 flex justify-between item-center">
              <Col span={8} >
                <Row>
                  <Col className="space-y-2.5">
                    <Row>
                      <Typography.Text className="text-2xl font-bold">
                        Memberships
                      </Typography.Text>
                    </Row>
                    <Row>
                      <Typography.Text className="text-sm font-medium text-grey">
                        {(isMembershipFound)
                          ? <Spin size="small" /> : (isPurchased ? purchasedMemberships?.length : memberships?.length)} {type} Memberships found
                      </Typography.Text>
                    </Row>
                  </Col>
                </Row>
              </Col>
              <Col md={{ span: 16 }} lg={{ span: 14 }} xl={{ span: 16 }} className="py-0 m-0 pt-1">
                <Col className="flex justify-between float-right">
                  <Button
                    id="add-product-button"
                    type="primary"
                    className="py-3 px-6 h-12 bg-500 mx-4 !hover:bg-primaryHover font-semibold flex"
                    style={{
                      backgroundColor: "blue",
                      color: "white",
                    }}
                    onClick={() => {
                      if (isRedirectLogin) {
                        window.location.href = loginUrl;
                      } else {
                        showModal();
                      }
                    }}
                  >
                    {createServiceIcon()} &nbsp; New Membership
                  </Button>
                  <Button
                    id="add-product-button"
                    style={{
                      color: "black",

                    }}
                    className="py-3 px-6 mx-4 h-12 bg-white !hover:bg-primaryHover font-semibold flex"
                    onClick={() => {
                      setCookie("returnUrl", `/marketplace/memberships/serviceUsage/booked`, 10);
                      navigate(routes.ServiceUsage.booked)
                    }}
                  >
                    {servicesIcon()} &nbsp; Services
                  </Button>
                  <Button
                    id="add-product-button"
                    type={stripeStatus.detailsSubmitted ? "default" : "primary"}
                    style={{ color: "white", fontWeight: "bold" }}
                    className="py-3 px-6 mx-4 h-12 bg-500 !hover:bg-primaryHover font-semibold"
                    disabled={stripeStatus.detailsSubmitted}
                    onClick={() => {
                      if (isRedirectLogin) {
                        window.location.href = loginUrl;
                      } else {
                        onboardSeller();
                      }
                    }}
                  >
                    <span style={{ fontWeight: "normal" }}> Setup </span>
                    <span style={{ fontWeight: "900", margin: "0 5px" }}>
                      Stripe
                    </span>
                    <span style={{ fontWeight: "normal" }}> Account</span>
                  </Button>
                </Col>
              </Col>
            </Row>
          </Col>
          <Row className="mx-16">
            <Col span={24}>
              <Tabs defaultActiveKey={type} size="large" items={items} onChange={onChange} />
            </Col>
          </Row>
          <Row className="mx-16">
            {isPurchased ? (
              <PurchasedList
                user={user}
                categorys={categorys}
                subCategorys={subCategorys}
                debouncedSearchTerm={debouncedSearchTerm}
              />
            ) : (
              <IssuedList
                user={user}
                categorys={categorys}
                subCategorys={subCategorys}
                debouncedSearchTerm={debouncedSearchTerm}
              />
            )}
            <div className="pb-12"></div>
          </Row>

        </div>
      )}
      {open && (
        <CreateMembershipModal
          open={open}
          user={user}
          handleCancel={handleCancel}
        //   categorys={categorys}
        //   resetPage={onPageChange}
        //   page={page}
        //   debouncedSearchTerm={debouncedSearchTerm}
        />
      )}
      {msg && openToast("bottom")}
    </>
  );
};

export default Membership;
