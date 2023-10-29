import React, { useEffect } from "react";
import { Col, Row } from "antd";
import { useMembershipDispatch, useMembershipState } from "../../contexts/membership";
import { actions as membershipActions } from "../../contexts/membership/actions";
import { Image, Typography } from "antd";
import { Images } from "../../images";
import MembershipCardPurchased from "./MembershipCardPurchased";
import LoaderComponent from "../Loader/LoaderComponent";

const IssuedList = ({ user, categorys, subCategorys, debouncedSearchTerm }) => {

  const { Title } = Typography;
  const { memberships, isMembershipsLoading } = useMembershipState();
  const membershipDispatch = useMembershipDispatch();

  useEffect(() => {
    membershipActions.fetchMembership(membershipDispatch);
  }, []);

  return (
    <>
      {isMembershipsLoading ? (
        <LoaderComponent />
      ) : memberships.length === 0 ? (
        <div className="h-screen w-full lg:mt-52 text-center items-center mx-auto">
          <Image src={Images.noProductSymbol} height={'120px'} preview={false} />
          <Title level={3} className="mt-2">
            No product found
          </Title>
        </div>
      ) : (
        <Row className="w-full my-4 flex flex-row" gutter={[12, 12]}>
          {memberships.map(({
            product,
            timePeriodInMonths,
            inventories,
            productName,
            productId,
            itemNumber,
            address,
            productImageLocation,
            savings,
            status,
          }) => {
            const inventoryId = inventories?.length > 0 ? inventories[0]?.address : '';
            return (
              <Col span={12} key={address}>
                <MembershipCardPurchased
                  user={user}
                  membership={{
                    ...product,
                    timePeriodInMonths,
                    Inventories: inventories,
                    productName,
                    productId,
                    inventoryId,
                    itemNumber,
                    membershipAddress: address,
                    productImageLocation,
                    savings,
                    expiryDate: "",
                    status,
                  }}
                  categorys={categorys}
                  subCategorys={subCategorys}
                  debouncedSearchTerm={debouncedSearchTerm}
                  membershipId={address}
                  isPurchasedList={false}
                />
              </Col>
            );
          })}
        </Row>
      )}
    </>
  );
};

export default IssuedList;
