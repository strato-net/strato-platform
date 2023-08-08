import React from 'react'
import { Space, Typography, Row, Col } from 'antd'
const { Title, Text } = Typography

const FeaturesTab = () => {
  // Dummy data for view.
  const data = [{
    title: "Applicances",
    description: "description 1",
    comment: "comment 1"
  },
  {
    title: "Interior Features",
    description: "description 2",
    comment: "comment 2"
  },
  {
    title: "Exterior Features",
    description: "description 3",
    comment: "comment 3"
  },
  {
    title: "WaterFront features",
    description: "description 4",
    comment: "comment 4"
  }
  ]
  return (
    <Row>
      {data.map((item, index) => {
        return <Col span={12} style={{ padding: '20px' }}> <Space direction="vertical">
          <Title level={5} style={{ marginBottom: '-5px' }}>{item.title}</Title>
          <Text> {item.description} </Text>
          <Text> {item.comment} </Text>
        </Space>
        </Col>
      })}
    </Row>
  )
}

export default FeaturesTab