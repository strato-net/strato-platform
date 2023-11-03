import React, { useEffect } from "react";
import MembershipCardPurchased from "./MembershipCardPurchased";
import { Col, Input, Row, Select, Spin } from "antd";
import {
  useMembershipDispatch,
  useMembershipState,
} from "../../contexts/membership";
import { actions } from "../../contexts/membership/actions";
import { Image, Typography } from "antd";
import { Images } from "../../images";
import { SearchOutlined } from "@ant-design/icons";
import helperJson from "../../../src/helpers/helper.json"
const { purchasedCardConfig } = helperJson

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
        <div className="h-screen w-full lg:mt-52 text-center items-center mx-auto">
          <Image src={Images.noProductSymbol} height={'120px'} preview={false} />
          <Title level={3} className="mt-2">
            No product found
          </Title>
        </div>
      ) : (
        <>

          {/* <Row className="flex justify-start w-full">
            <Col span={12} className="flex justify-between">
            <Col span={8}>
              <Input
                size="large"
                placeholder="Search Purchased Membership"
                className="header-search rounded-full"
                prefix={<SearchOutlined style={{ color: "#989898" }} />}
              />
            </Col>
            <Col span={6} className="rounded-full">
              <Select
                defaultValue="lucy"
                size="large"
                className="rounded-full"
                style={{ width: '100%', borderRadius:'50% !important' }}
                disabled
                options={[{ value: 'category', label: 'Category' }]}
              />
            </Col>
            <Col span={6}>
              <Select
                defaultValue="lucy"
                size="large"
                className="rounded-full"
                style={{ width: '100%' }}
                disabled
                options={[{ value: 'duration', label: 'Duration' }]}
              />
            </Col>
            </Col>
          </Row> */}
          <Row className="w-full my-4 flex flex-row" gutter={[32, 16]}>
            {purchasedMemberships.map((product, index) => {
              return (
                <Col span={12}>
                  <MembershipCardPurchased
                    cardConfig={purchasedCardConfig}
                    user={user}
                    membership={product}
                    categorys={categorys}
                    subCategorys={subCategorys}
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
