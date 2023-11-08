import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Col, Row, Tabs, Typography } from 'antd';
import PurchasedList from '../PurchasedList';
import IssuedList from '../IssuedList';
import { setCookie } from '../../../helpers/cookie';

const { Text } = Typography;
const MembershipListTabComponent = ({ props: { type, isPurchased, user, debouncedSearchTerm } }) => {
  const navigate = useNavigate();

  const tabItems = [{ key: "purchased", isActive: isPurchased }, { key: "issued", isActive: !isPurchased }]
  const items = tabItems.map((item, index) => {
    return { ...item, label: <Text className="text-xl font-bold leading-6 capitalize" style={{ color: item.isActive ? "#181EAC" : "rgba(0, 0, 0, 0.4)" }}>{item.key}</Text> }
  })

  const onChange = (key) => {
    setCookie("returnUrl", `/marketplace/memberships/${key}`, 10);
    navigate(`/memberships/${key}`)
  };

  return (
    <>
      <Row className="mx-16">
        <Col span={24}>
          <Tabs defaultActiveKey={type} size="large" items={items} onChange={onChange} />
        </Col>
      </Row>
      <Row className="mx-16">
        {isPurchased ? (
          <PurchasedList
            user={user}
            debouncedSearchTerm={debouncedSearchTerm}
          />
        ) : (
          <IssuedList
            user={user}
            debouncedSearchTerm={debouncedSearchTerm}
          />
        )}
        <div className="pb-12"></div>
      </Row>
    </>
  )
}

export default MembershipListTabComponent
