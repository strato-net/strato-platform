import React, { useState, useEffect } from "react";

import {
  Breadcrumb,
  Input,
  Button,
  Col,
  notification,
  Dropdown,
  Spin,
  Image,
  Typography,
  Pagination,
  Tabs,
  Row,
} from "antd";
import { DownOutlined } from "@ant-design/icons";
import MembershipCard from "./MembershipCard";
import CreateMembershipModal from "./CreateMembershipModal";
import { actions } from "../../contexts/membership/actions";
import {
  useMembershipDispatch,
  useMembershipState,
} from "../../contexts/membership";

import useDebounce from "../UseDebounce";
//categories
import { actions as categoryActions } from "../../contexts/category/actions";
import { useCategoryDispatch, useCategoryState } from "../../contexts/category";
//sub-categories
import { useSubCategoryState } from "../../contexts/subCategory";
import { Images } from "../../images";
import ClickableCell from "../ClickableCell";
import routes from "../../helpers/routes";
import { useAuthenticateState } from "../../contexts/authentication";
import { Link, useLocation, useNavigate } from "react-router-dom";
import PurchasedList from "./PurchasedList";
import IssuedList from "./IssuedList";
import ListNowIndex from "./ListNowIndex";
import { createServiceIcon, sellServicesIcon, services, servicesIcon } from "../../images/SVGComponents";

const { Search } = Input;
const { Title, Text } = Typography;

const Membership = (user) => {
  let { state } = useLocation();
  const [open, setOpen] = useState(
    state && user.user ? state.isCalledFromHeader : false
  );
  useEffect(() => {
    if (state && user.user) {
      setOpen(state.isCalledFromHeader);
    } else {
      setOpen(false);
    }
    window.history.replaceState({}, "/memberships");
  }, [state]);

  const dispatch = useMembershipDispatch();
  const [api, contextHolder] = notification.useNotification();
  const [queryValue, setQueryValue] = useState("");
  const limit = 10;
  const [offset, setOffset] = useState(0);
  const [isSearch, setIsSearch] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(10);
  const debouncedSearchTerm = useDebounce(queryValue, 1000);
  let [typeDisplay, setTypeDisplay] = useState("purchase");
  const [visible, setVisible] = useState(false);

  //Categories
  const categoryDispatch = useCategoryDispatch();

  //Sub-categories

  const { categorys, iscategorysLoading } = useCategoryState();
  const { subCategorys, issubCategorysLoading } = useSubCategoryState();

  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();

  useEffect(() => {
    categoryActions.fetchCategories(categoryDispatch);
  }, [categoryDispatch]);

  const openToast = (placement) => {
    if (success) {
      api.success({
        message: message,
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: message,
        onClose: actions.resetMessage(dispatch),
        placement,
        key: 2,
      });
    }
  };

  let {
    memberships,
    ismembershipsLoading,
    message,
    success,
    stripeStatus,
    isLoadingStripeStatus,
  } = useMembershipState();

  useEffect(() => {
    actions.sellerStripeStatus(dispatch, user?.user?.organization);
  }, [dispatch, user]);

  const navigate = useNavigate();

  const onboardSeller = async () => {
    navigate(routes.OnboardingSellerToStripe.url);
  };

  // useEffect(() => {
  //   if (isSearch) {
  //     setOffset(0);
  //     actions.fetchMembership(dispatch, limit, 0, debouncedSearchTerm);
  //     setIsSearch(false);
  //   } else setIsSearch(true);
  //   actions.fetchMembership(dispatch, limit, offset, debouncedSearchTerm);
  // }, [limit, offset, debouncedSearchTerm]);

  useEffect(() => {
    let len = memberships.length;
    let total;
    if (len === limit) total = page * 10 + limit;
    else total = (page - 1) * 10 + limit;
    setTotal(total);
  }, [memberships]);

  const showModal = () => {
    hasChecked && !isAuthenticated && loginUrl !== undefined
      ? (window.location.href = loginUrl)
      : setOpen(true);
  };

  const handleCancel = (message) => {
    if (message === "success") {
      setOpen(false);
      actions.fetchMembership(dispatch, limit, offset, debouncedSearchTerm);
    } else {
      setOpen(false);
    }
  };

  const queryHandle = (e) => {
    setQueryValue(e.target.value);
    setIsSearch(true);
    setPage(1);
  };

  const onPageChange = (page) => {
    setOffset((page - 1) * limit);
    setPage(page);
  };
  const dummyData = [
    //TODO, unhardcode this
    {
      //When the utility of this
      label: "All", //understood
      key: "1",
    },
    {
      label: "Health",
      key: "2",
    },
  ];
  const onChange = (key) => {
    setTypeDisplay(key);
  };

  useEffect(() => {
    setTypeDisplay(typeDisplay);
  });

  const items = [
    {
      key: "purchase",
      label: <Text className="text-xl font-bold leading-6" style={{ color: typeDisplay === "purchase" ? "#181EAC" : "rgba(0, 0, 0, 0.4)" }}>Purchased</Text>,
    },
    {
      key: "issued",
      label: <Text className="text-xl font-bold leading-6" style={{ color: typeDisplay === "issued" ? "#181EAC" : "rgba(0, 0, 0, 0.4)" }}>Issued</Text>,
    },
  ];
  const closeSellModal = () => {
    setVisible(false);
  };

  const openSellModal = () => {
    setVisible(true);
  };
  return (
    <>
      {contextHolder}
      {stripeStatus === null || isLoadingStripeStatus ? (
        <div className="h-screen flex justify-center items-center mx-auto">
          <Spin spinning={isLoadingStripeStatus} size="large" />
        </div>
      ) : (
        <div className=" mt-10 min-h-full">
          <Row className="mx-16 mb-4">
            <Col span={22}>
              <Breadcrumb>
                <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
                  <ClickableCell href={routes.Marketplace.url}>
                    <Text className="primary-theme-text text-md font-bold" underline>
                      Home
                    </Text>
                  </ClickableCell>
                </Breadcrumb.Item>
                <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
                  <Text className="text-md font-bold">
                    Memberships
                  </Text>
                </Breadcrumb.Item>
              </Breadcrumb>
            </Col>
          </Row>

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
                        {memberships.length} {typeDisplay} Memberships found
                      </Typography.Text>
                    </Row>
                  </Col>
                </Row>
              </Col>
              {/* <Col>
                    <Dropdown.Button
                        style={{ margin: '10px' }}
                        icon={<DownOutlined />}
                        menu={{ dummyData }}
                    >
                        All
                    </Dropdown.Button>
                </Col> */}
              <Col span={14} className="py-0 m-0 pt-1">
                <Col className="flex justify-between">
                  <Button
                    id="add-product-button"
                    type="primary"
                    className="py-3 px-6 h-12 bg-500 !hover:bg-primaryHover font-semibold flex"
                    style={{
                      backgroundColor: "blue",
                      color: "white",
                    }}
                    onClick={() => {
                      if (
                        hasChecked &&
                        !isAuthenticated &&
                        loginUrl !== undefined
                      ) {
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
                    // type="primary"
                    style={{
                      // backgroundColor: "green",
                      color: "black",
                    }}
                    className="py-3 px-6 h-12 bg-white align-middle font-semibold !hover:bg-primaryHover flex"
                    onClick={() => {
                      if (
                        hasChecked &&
                        !isAuthenticated &&
                        loginUrl !== undefined
                      ) {
                        window.location.href = loginUrl;
                      } else {
                        setVisible(true);
                      }
                    }}
                  >
                    {sellServicesIcon()}  &nbsp; Sell Membership
                  </Button>
                  <Button
                    id="add-product-button"
                    // type="primary"
                    style={{
                      // backgroundColor: "orange",
                      color: "black",

                    }}
                    className="py-3 px-6 h-12 bg-white !hover:bg-primaryHover font-semibold flex"
                    onClick={() => navigate("/memberships/serviceUsage/booked")}
                  >
                    {servicesIcon()} &nbsp; Services
                  </Button>
                  <Button
                    id="add-product-button"
                    // type="primary"
                    style={{
                      // backgroundColor: "red",
                      color: "black",

                    }}
                    className="py-3 px-6 h-12 bg-500 !hover:bg-primaryHover font-semibold"
                  >
                    Manage Services
                  </Button>
                  <Button
                    id="add-product-button"
                    type="primary"
                    style={{ color: "white", fontWeight: "bold" }}
                    className="py-3 px-6 h-12 bg-500 !hover:bg-primaryHover font-semibold"
                    disabled={stripeStatus.detailsSubmitted}
                    onClick={() => {
                      if (
                        hasChecked &&
                        !isAuthenticated &&
                        loginUrl !== undefined
                      ) {
                        window.location.href = loginUrl;
                      } else {
                        onboardSeller();
                      }
                    }}
                  >
                    <span style={{ fontWeight: "normal" }}> Setup </span>
                    <span style={{ fontWeight: "900", margin: "0 5px" }}>
                      {" "}
                      Stripe{" "}
                    </span>
                    <span style={{ fontWeight: "normal" }}> Account</span>
                  </Button>
                </Col>
              </Col>
            </Row>
          </Col>
          <Row className="mx-16">
            <Col span={24}>
              <Tabs defaultActiveKey="1" size="large" items={items} onChange={onChange} />
            </Col>
          </Row>
          <Row className="mx-16">
            {typeDisplay === "purchase" ? (
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
          {/* <Row>
            <Pagination
              current={page}
              onChange={onPageChange}
              total={total}
              className="mx-auto"
            />
          </Row> */}
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
      {visible && (
        <ListNowIndex
          open={visible}
          user={user}
          handleCancel={closeSellModal}
          onClick={() => { setVisible(true) }}
          // formik={formik}
          type="Sale"
        // id="None"
        // getIn={getIn}
        // isCreateMembershipSubmitting={isCreateInventorySubmitting}
        />
      )}
      {message && openToast("bottom")}
    </>
  );
};

export default Membership;
