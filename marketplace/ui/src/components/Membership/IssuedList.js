import React, { useEffect, useState } from "react";
import MembershipCard from "./MembershipCard";
import { Spin } from "antd";
import {
  useMembershipDispatch,
  useMembershipState,
} from "../../contexts/membership";
import { actions } from "../../contexts/membership/actions";
import { Image, Typography } from "antd";
import { Images } from "../../images";

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
    ismembershipsLoading,
  } = useMembershipState();
  
  useEffect(() => {
    console.log(1)
    actions.fetchMembership(dispatch);
    console.log(2)
  }, []);

  const memberships_issued = memberships
    .filter((membership_) => membership_.inventories.length > 0)
    .filter(
      (membership) =>
        membership.ownerOrganization === membership.inventories[0].manufacturer
    );
console.log("ismembershipsLoading", ismembershipsLoading);
  const { Title } = Typography;
  return (
    <>
      <h2 className="text-2xl font-semibold">Issued Memberships</h2>
      {ismembershipsLoading ? (
        <div className="h-screen flex justify-center items-center">
          <Spin spinning={ismembershipsLoading} size="large" />
        </div>
      ) : memberships_issued.length === 0 ? (
        <div className="h-screen justify-center flex flex-col items-center">
          <Image src={Images.noProductSymbol} preview={false} />
          <Title level={3} className="mt-2">
            No product found
          </Title>
        </div>
      ) : (
        <div className="my-4">
          {memberships_issued.map((product, index) => {
            return (
              <MembershipCard
                user={user}
                membership={product}
                categorys={categorys}
                subCategorys={subCategorys}
                key={index}
                debouncedSearchTerm={debouncedSearchTerm}
              />
            );
          })}
        </div>
      )}
    </>
  );
};

export default IssuedList;
