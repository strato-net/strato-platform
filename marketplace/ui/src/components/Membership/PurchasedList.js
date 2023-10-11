import React, { useEffect } from "react";
import MembershipCardPurchased from "./MembershipCardPurchased";
import { Col, Row, Spin } from "antd";
import {
  useMembershipDispatch,
  useMembershipState,
} from "../../contexts/membership";
import { actions } from "../../contexts/membership/actions";
import { Image, Typography } from "antd";
import { Images } from "../../images";

const PurchasedList = (
  user,
  categorys,
  subCategorys,
  debouncedSearchTerm
) => {
  const dispatch = useMembershipDispatch();
  const { purchasedMemberships, isPurchasedMembershipLoading } = useMembershipState();
  useEffect(() => { actions.fetchPurchasedMemberships(dispatch) }, []);
  const { Title } = Typography;
  return (
    <>
      {isPurchasedMembershipLoading ? (
        <div className="h-screen flex justify-center items-center mx-auto">
          <Spin spinning={isPurchasedMembershipLoading} size="large" />
        </div>
      ) : purchasedMemberships.length === 0 ? (
        <div className="h-screen w-full justify-center flex flex-col items-center">
          <div className="text-center">
            <Image src={Images.noProductSymbol} preview={false} />
            <Title level={3} className="mt-2 text-center">
              No product found
            </Title>
          </div>
        </div>
      ) : (
        <Row className="my-4" gutter={[32, 16]}>
          {purchasedMemberships.map((product, index) => {
            return (
              <Col span={12}>
                <MembershipCardPurchased
                  user={user}
                  membership={product}
                  categorys={categorys}
                  subCategorys={subCategorys}
                  debouncedSearchTerm={debouncedSearchTerm}
                  membershipId={product.itemNumber}
                  isPurchasedList={true}
                />
              </Col>
            );
          })}
        </Row>
      )}
    </>
  );
};

export default PurchasedList;
