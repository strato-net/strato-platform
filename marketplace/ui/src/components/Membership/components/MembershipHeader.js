import React from "react";
import { useNavigate } from "react-router-dom";
import { Row, Col, Typography, Spin, Button } from "antd";
import { createServiceIcon, servicesIcon } from "../../../images/SVGComponents";
import routes from "../../../helpers/routes";
import { setCookie } from "../../../helpers/cookie";
import { useMembershipState } from "../../../contexts/membership";
import { useAuthenticateState } from "../../../contexts/authentication";

const MembershipHeader = ({ type, isMembershipFound, isPurchased, showModal }) => {
  const navigate = useNavigate();
  const { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();

  const {
    memberships,
    purchasedMemberships,
    stripeStatus,
  } = useMembershipState();

  const onboardSeller = async () => {
    navigate(routes.OnboardingSellerToStripe.url);
  };

  const isRedirectLogin = hasChecked && !isAuthenticated && loginUrl !== undefined;

  return (
    <Col className="mt-2 h-24 py-5 bg-red-800" style={{ backgroundColor: '#F2F2F2' }}>
      <Row className="mx-16 flex justify-between item-center">
        <Col span={8}>
          <Row>
            <Col className="space-y-2.5">
              <Row>
                <Typography.Text className="text-2xl font-bold">
                  Memberships
                </Typography.Text>
              </Row>
              <Row>
                <Typography.Text className="text-sm font-medium text-grey">
                  {isMembershipFound
                    ? <Spin size="small" />
                    : `${isPurchased ? purchasedMemberships?.length : memberships?.length} ${type} Memberships found`
                  }
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
              type={stripeStatus?.detailsSubmitted ? "default" : "primary"}
              style={{ color: "white", fontWeight: "bold" }}
              className="py-3 px-6 mx-4 h-12 bg-500 !hover:bg-primaryHover font-semibold"
              disabled={stripeStatus?.detailsSubmitted}
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
  );
};

export default MembershipHeader;
