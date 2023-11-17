import React from 'react'
import { Image, Typography } from 'antd'
import { Images } from '../../images';
const { Title } = Typography;

const NoProductComponent = ({ text }) => {
  return (
    <div className="h-screen w-full lg:mt-52 text-center items-center mx-auto">
      <Image src={Images.noProductSymbol} height={'120px'} preview={false} />
      <Title level={3} className="mt-2">
        No {text} found
      </Title>
    </div>
  )
}

export default NoProductComponent;
