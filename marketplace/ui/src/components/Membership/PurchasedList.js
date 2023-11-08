import React from "react";
import { Col, Row, Typography } from "antd";

import MembershipCard from "./MembershipCard";
import { useMembershipState } from "../../contexts/membership";
import helperJson from "../../../src/helpers/helper.json"
import LoaderComponent from "../Loader/LoaderComponent";
import NoProductComponent from "../NoProductFound/NoProductComponent";
const { purchasedCardConfig } = helperJson
const { Title } = Typography;

const PurchasedList = (
  user,
  // categorys,
  // subCategorys,
  debouncedSearchTerm
) => {
  const { purchasedMemberships, isPurchasedMembershipLoading } = useMembershipState();

  return (
    <>
      {isPurchasedMembershipLoading ? (
        <LoaderComponent />
      ) : purchasedMemberships.length === 0 ? (
        <NoProductComponent />
      ) : (
        <>
          <Row className="w-full my-4 flex flex-row" gutter={[32, 16]}>
            {purchasedMemberships.map((product, index) => {
              return (
                <Col span={12} key={index}>
                  <MembershipCard
                    cardConfig={purchasedCardConfig}
                    user={user}
                    membership={product}
                    // categorys={categorys}
                    // subCategorys={subCategorys}
                    debouncedSearchTerm={debouncedSearchTerm}
                    membershipId={product.itemNumber}
                  />
                </Col>
              );
            })}
          </Row>
        </>
      )}

    </>
  );
};

export default PurchasedList;
