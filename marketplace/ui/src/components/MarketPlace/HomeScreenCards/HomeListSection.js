import React from 'react'
import { Button, Col, Image, Row, Typography } from 'antd'
import HomeScreenProduct from './HomeScreenProduct';
const { Title, Text } = Typography;

const HomeListSection = ({ heading, list }) => {
  return (
    <Row className='mt-16'>
      <Col span={24}>
        <Row className='flex justify-between '>
          <Title level={2}>{heading} </Title>
          <Button className='w-40 h-10 rounded-full font-bold' > View All </Button>
        </Row>
        <Row gutter={[12,12]} className='mt-5 py-5'>
          {list?.map((item, index) => <HomeScreenProduct
            productDetail={item}
          />
          )}
        </Row>
      </Col>
    </Row>
  )
}

export default HomeListSection