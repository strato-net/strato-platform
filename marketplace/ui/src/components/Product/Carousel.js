import React from 'react'
import { Carousel, Image } from 'antd';
import { RightOutlined, LeftOutlined } from "@ant-design/icons";

const CarouselComponent = (props) => {
  const { images } = props

  return (
    <>
      <Carousel arrows prevArrow={<LeftOutlined />} nextArrow={<RightOutlined />} >
        {images?.map((item, index) => {
          return <div key={index} className='w-full m-2.5' style={{ height: '70%' }}>
            <Image
              width={'100%'}
              preview={false}
              src={item}
            />
          </div>
        })}
      </Carousel>
    </>
  )
}

export default CarouselComponent
