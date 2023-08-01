import React from 'react'
import { Carousel, Image } from 'antd';
import { RightOutlined, LeftOutlined } from "@ant-design/icons";

const CarouselComponent = (props) => {
  const { images } = props

  return (
    <>
      <Carousel arrows prevArrow={<LeftOutlined />} nextArrow={<RightOutlined />} >
        {images?.map((item, index) => {
          return <div key={index} style={{ width: '100%', height: '70%', margin: '10px' }}>
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