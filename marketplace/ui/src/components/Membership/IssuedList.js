import React, { useEffect, useState } from "react";
import MembershipCard from "./MembershipCard";
import { Col, Row, Spin } from "antd";
import {
  useMembershipDispatch,
  useMembershipState,
} from "../../contexts/membership";
import { actions } from "../../contexts/membership/actions";
import { Image, Typography } from "antd";
import { Images } from "../../images";
import MembershipCardPurchased from "./MembershipCardPurchased";

const IssuedList = (
  user,
  categorys,
  subCategorys,
  key,
  debouncedSearchTerm
) => {
  const dispatch = useMembershipDispatch();
  let {
    memberships,
    isMembershipsLoading,
  } = useMembershipState();

  useEffect(() => {
    actions.fetchMembership(dispatch);
  }, []);

  const memberships_issued = memberships
    .filter((membership_) => membership_?.inventories?.length > 0)
    .filter(
      (membership) =>
        membership.ownerOrganization === membership?.inventories[0].manufacturer
    );
  const { Title } = Typography;
  return (
    <>
      {isMembershipsLoading ? (
        <div className="h-screen flex justify-center items-center mx-auto">
          <Spin spinning={isMembershipsLoading} size="large" />
        </div>
      ) : memberships_issued?.length === 0 ? (
        <div className="h-screen justify-center flex flex-col items-center mx-auto">
          <Image src={Images.noProductSymbol} preview={false} />
          <Title level={3} className="mt-2">
            No product found
          </Title>
        </div>
      ) : (
        <Row className="my-4 flex flex-row" gutter={[12, 12]}>
          {memberships_issued.map((item, index) => {
            // membershipId,
            console.log("item", item.inventoryAddress);
            let transformedData = { ...item.product }
            transformedData["timePeriodInMonths"] = item.timePeriodInMonths
            transformedData["Inventories"] = item.inventories;
            transformedData["productName"] = transformedData.name;
            transformedData["inventoryId"] = item.inventories[0].address;
            transformedData["membershipAddress"] = item.membershipAddress;
            console.log("transformedData", transformedData);
            return (
              <Col span={12}>
                <MembershipCardPurchased
                  user={user}
                  membership={transformedData}
                  categorys={categorys}
                  subCategorys={subCategorys}
                  debouncedSearchTerm={debouncedSearchTerm}
                  membershipId={null}
                  isPurchasedList={false}
                />
              </Col>
              // <MembershipCard
              //   user={user}
              //   membership={item}
              //   categorys={categorys}
              //   subCategorys={subCategorys}
              //   key={index}
              //   debouncedSearchTerm={debouncedSearchTerm}
              // />
            );
          })}

        </Row>
      )}
    </>
  );
};

export default IssuedList;
