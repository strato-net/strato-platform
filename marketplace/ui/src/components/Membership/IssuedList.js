import React, { useEffect, useState } from "react";
// import MembershipCard from "./MembershipCard";
import { Spin } from "antd";
import { useMembershipDispatch, useMembershipState, } from "../../contexts/membership";
import { actions } from "../../contexts/membership/actions";
import { Image, Typography } from "antd";
import { Images } from "../../images";
import MembershipCardPurchased from "./MembershipCardPurchased";
const { Title } = Typography;

const IssuedList = (
  user,
  categorys,
  subCategorys,
  debouncedSearchTerm
) => {
  const dispatch = useMembershipDispatch();
  let { issuedMembership, isIssuedMembershipLoading } = useMembershipState();
  const [membershipList, setMembershipList] = useState([]);

  useEffect(() => { actions.fetchIssuedMemberships(dispatch) }, []);
  useEffect(() => { setMembershipList(issuedMembership ?? []) }, [issuedMembership])

  return (
    <>
      <h2 className="text-2xl font-semibold">Issued Memberships</h2>
      {isIssuedMembershipLoading ? (
        <div className="h-screen flex justify-center items-center">
          <Spin spinning={isIssuedMembershipLoading} size="large" />
        </div>
      ) : membershipList.length === 0 ? (
        <div className="h-screen justify-center flex flex-col items-center">
          <Image src={Images.noProductSymbol} preview={false} />
          <Title level={3} className="mt-2">
            No product found
          </Title>
        </div>
      ) : (
        <div className="my-4">
          {membershipList.map((product, index) => {
            return (
              // <MembershipCard
              //   user={user}
              //   membership={product}
              //   categorys={categorys}
              //   subCategorys={subCategorys}
              //   key={index}
              //   debouncedSearchTerm={debouncedSearchTerm}
              // />

              <MembershipCardPurchased
                user={user}
                membership={product}
                categorys={categorys}
                subCategorys={subCategorys}
                debouncedSearchTerm={debouncedSearchTerm}
                membershipId={product.itemNumber}
                isPurchasedList={false}
              />
            );
          })}
        </div>
      )}
    </>
  );
};

export default IssuedList;
