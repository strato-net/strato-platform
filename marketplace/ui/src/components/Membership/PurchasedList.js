import React, { useEffect, useState } from "react";
import MembershipCardPurchased from "./MembershipCardPurchased";
import { Spin } from "antd";
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
  key,
  debouncedSearchTerm
) => {
  const dispatch = useMembershipDispatch();
  const { purchasedMemberships, isPurchasedMembershipLoading } =
    useMembershipState();
  useEffect(() => {
    actions.fetchPurchasedMemberships(dispatch);
  }, []);
  const { Title } = Typography;
  return (
    <>
      <h2 className="text-2xl font-semibold">Purchased Memberships</h2>
      {isPurchasedMembershipLoading ? (
        <div className="h-screen flex justify-center items-center">
          <Spin spinning={isPurchasedMembershipLoading} size="large" />
        </div>
      ) : purchasedMemberships.length === 0 ? (
        <div className="h-screen justify-center flex flex-col items-center">
          <Image src={Images.noProductSymbol} preview={false} />
          <Title level={3} className="mt-2">
            No product found
          </Title>
        </div>
      ) : (
        <div className="my-4">
          {purchasedMemberships.map((product, index) => {
            return (
              <MembershipCardPurchased
                user={user}
                membership={product}
                categorys={categorys}
                subCategorys={subCategorys}
                debouncedSearchTerm={debouncedSearchTerm}
                membershipId={product.itemNumber}
              />
            );
          })}
        </div>
      )}
    </>
  );
};

export default PurchasedList;
