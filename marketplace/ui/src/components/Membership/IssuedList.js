import React, { useEffect } from "react";
import { Col, Row } from "antd";
import { useMembershipDispatch, useMembershipState } from "../../contexts/membership";
import { actions as membershipActions } from "../../contexts/membership/actions";
import { Image, Typography } from "antd";
import { Images } from "../../images";
import MembershipCardPurchased from "./MembershipCardPurchased";
import LoaderComponent from "../Loader/LoaderComponent";
import NoProductComponent from "../NoProductFound/NoProductComponent";
import helperJson from "../../../src/helpers/helper.json"

const { issuedCardConfig } = helperJson

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
        <NoProductComponent />
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
                  cardConfig={issuedCardConfig}
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
