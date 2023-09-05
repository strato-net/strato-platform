import React from 'react'
import { Typography, Divider, Row, Col } from 'antd';

function PriceHistoryTab(props) {
  const { property } = props;

  return (
    <Col>
      <Row>
        <Col span={11} offset={1}>
          <Typography.Title level={5} className='mt-0'>Price History</Typography.Title>
          <Row>
            <Col span={24}>
              <Row>
                <Col span={12}><Typography.Paragraph className='border-btm'>Sale Date</Typography.Paragraph></Col>
                <Col span={12}><Typography.Paragraph className='border-btm'>Price</Typography.Paragraph></Col>
              </Row>
              <Row>
                <Col span={11}>
                  <Typography.Paragraph>12 july</Typography.Paragraph>
                </Col>
                <Col span={11}>
                  <Typography.Paragraph>1200</Typography.Paragraph>
                </Col>
              </Row>

            </Col>

          </Row>
        </Col>

        <Col span={11} offset={1}>
          <Typography.Title level={5} className='mt-0'>Tax History</Typography.Title>
          <Row >
            <Col span={12}>
              <Typography.Paragraph className='border-btm'>Date</Typography.Paragraph>
              <Typography.Paragraph>12 july</Typography.Paragraph>
              <Typography.Paragraph>13 july</Typography.Paragraph>
              <Typography.Paragraph>14 july</Typography.Paragraph>
            </Col>
            <Col span={12}>
              <Typography.Paragraph className='border-btm'>Assessment</Typography.Paragraph>
              <Typography.Paragraph>$ 442300</Typography.Paragraph>
              <Typography.Paragraph>$ 440000</Typography.Paragraph>
              <Typography.Paragraph>$ 640000</Typography.Paragraph>
            </Col>
          </Row>
        </Col>
      </Row>

    </Col>
  )
}

export default PriceHistoryTab
