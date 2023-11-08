import React from "react";
import { Col, Row } from "antd";

import { useMembershipState } from "../../contexts/membership";
import MembershipCard from "./MembershipCard";
import helperJson from "../../../src/helpers/helper.json"
import LoaderComponent from "../Loader/LoaderComponent";
import NoProductComponent from "../NoProductFound/NoProductComponent";

const { issuedCardConfig } = helperJson;

const IssuedList = (
  user,
  debouncedSearchTerm
) => {
  const { memberships, isMembershipsLoading } = useMembershipState();

  return (
    <>
      {isMembershipsLoading ? (
        <LoaderComponent />
      ) : memberships?.length === 0 ? (
        <NoProductComponent text={"product"} />
      ) : (
        <Row className="w-full my-4 flex flex-row" gutter={[12, 12]}>
          {memberships?.map((item, index) => {
            // membershipId,
            let transformedData = { ...item.product }
            transformedData["timePeriodInMonths"] = item.timePeriodInMonths
            transformedData["Inventories"] = item?.inventories;
            transformedData["productName"] = item?.productName;
            transformedData["productId"] = item.productId;
            if (item.inventories && item.inventories?.length > 0) {
              transformedData["inventoryId"] = item.inventories[0]?.address;
            } else {
              transformedData["inventoryId"] = '';
            }
            transformedData["itemNumber"] = item.itemNumber;
            transformedData["membershipAddress"] = item.address;
            transformedData["productImageLocation"] = item.productImageLocation;
            transformedData["savings"] = item.savings;
            transformedData["expiryDate"] = "";
            transformedData["status"] = item.status;
            return (
              <Col span={12} key={index}>
                <MembershipCard
                  cardConfig={issuedCardConfig}
                  user={user}
                  membership={transformedData}
                  debouncedSearchTerm={debouncedSearchTerm}
                  membershipId={item.address}
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
