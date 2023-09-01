import React, { useEffect, useState } from "react";
import MembershipCardPurchased from "./MembershipCardPurchased";
import {
    Spin,
} from "antd";
import {
  useMembershipDispatch,
  useMembershipState,
} from "../../contexts/membership";
import { actions } from "../../contexts/membership/actions";

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
  console.log("purchasedMemberships");
  return (
    <>
      {isPurchasedMembershipLoading  ? (
        <div className="h-screen flex justify-center items-center">
          <Spin spinning={isPurchasedMembershipLoading} size="large" />
        </div>
      ) : (
        <div className="my-4">
          <h2 className="text-2xl font-semibold">Purchased Memberships</h2>
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
