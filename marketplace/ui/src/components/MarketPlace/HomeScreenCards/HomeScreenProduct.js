import React from 'react'
import { Card, Col, Image, Row, Typography } from 'antd'
import { purpleCheckIcon, whiteCartIcon } from '../../../images/SVGComponents';
const { Title, Text } = Typography;

const HomeScreenProduct = ({ productDetail }) => {
  const { name, price, quantity, image } = productDetail;

  return (
    <Col span={6} xs={24} sm={12} md={8} lg={6} >
      <Card className='h-auto'>
        <Image className='rounded-md' height={400} width={'100%'} preview={false} src={image} />
        <Row className='my-2'><Title level={4}>{name}</Title>{purpleCheckIcon()}</Row>
        <Row className='theme-bg p-2' gutter={[12, 12]}>
          <Col span={12}>
            <Text className='block .txt-grey'> Price</Text>
            <Text strong> {price} USD</Text>
          </Col>
          <Col span={12}>
            <Text className='block'> Quantity</Text>
            <Text strong>{quantity} </Text>
          </Col>
        </Row>
        <Row className='mt-4'>
          <Col span={16} className='bg-primary h-10 rounded-md'>
            <Text strong className='block text-white mt-2 text-center'> Buy Now </Text>
          </Col>
          <Col span={4} offset={2} className='bg-primary h-10 p-3 flex justify-between rounded-md'>
            <span className='block mx-auto'>
              {whiteCartIcon()}
            </span>
          </Col>
        </Row>
      </Card>
    </Col>
  )
}

export default HomeScreenProduct;