import React, { useEffect } from "react";
import { Col, Row, Spin, Image, Typography } from "antd";

import MembershipCardPurchased from "./MembershipCardPurchased";
import { useMembershipState } from "../../contexts/membership";
import { Images } from "../../images";
import helperJson from "../../../src/helpers/helper.json"
const { purchasedCardConfig } = helperJson
const { Title } = Typography;

const PurchasedList = (
  user,
  categorys,
  subCategorys,
  debouncedSearchTerm
) => {
  const { purchasedMemberships, isPurchasedMembershipLoading } = useMembershipState();

  return (
    <>
      {isPurchasedMembershipLoading ? (
        <div className="h-screen flex justify-center items-center mx-auto">
          <Spin spinning={isPurchasedMembershipLoading} size="large" />
        </div>
      ) : purchasedMemberships.length === 0 ? (
        <div className="h-screen w-full lg:mt-52 text-center items-center mx-auto">
          <Image src={Images.noProductSymbol} height={'120px'} preview={false} />
          <Title level={3} className="mt-2">
            No product found
          </Title>
        </div>
      ) : (
        <>

          <Row className="w-full my-4 flex flex-row" gutter={[32, 16]}>
            {purchasedMemberships.map((product, index) => {
              return (
                <Col span={12} key={index}>
                  <MembershipCardPurchased
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
