import React from 'react'
import { Card, Col, Row, Typography } from 'antd'
const { Text } = Typography;
const SavingCard = ({ serviceName, serviceCost }) => {
  return (
    <Card className="shadow-md m-2">
      <Row className="mt-2">
        <Col span={24}>
          <Text className="block text-base text-grey font-medium">
            Name
          </Text>
        </Col>
        <Col span={24}>
          <Text className="block text-lg ">{serviceName}</Text>
        </Col>
      </Row>
      <Row className="mt-2">
        <Col span={24}>
          <Text className="block text-base text-grey font-medium">
            Effective Cost Saving
          </Text>
        </Col>
        <Col span={24}>
          <Text
            className="block text-lg font-bold"
            style={{ color: "green" }}
          >
            $ {serviceCost ?? "--"}
          </Text>
        </Col>
      </Row>
    </Card>
  )
}

export default SavingCard