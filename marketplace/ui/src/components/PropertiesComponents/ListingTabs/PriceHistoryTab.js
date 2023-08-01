import React from 'react'
import { Typography, Divider, Row, Col } from 'antd';

function PriceHistoryTab(props) {
  const { property } = props;

  return (
    <Col>
      <Typography.Title level={5} style={{ marginTop: 0 }}>Price History</Typography.Title>

      {property?.priceHistory?.map((date) => (
        <Typography.Paragraph>{`Sold on ${date}`}</Typography.Paragraph>
      ))}

      <Typography.Title level={5}>Tax History</Typography.Title>
      <Row>
        <Col span={10}>
          <Typography.Paragraph>Date</Typography.Paragraph>
        </Col>
        <Col offset={2}>
          <Typography.Paragraph>Assessment</Typography.Paragraph>
        </Col>
      </Row>
      <Divider style={{ marginTop: 0 }} />

      <Col span={10}>
        <Typography.Paragraph>Tax history</Typography.Paragraph>
      </Col>
      <Col offset={2}>
        <Typography.Paragraph>Assessment History</Typography.Paragraph>
      </Col>
    </Col>
  )
}

export default PriceHistoryTab