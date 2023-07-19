import React from 'react'
import { Carousel, Image } from 'antd';
import { RightOutlined, LeftOutlined } from "@ant-design/icons";

const contentStyle = {
  margin: 0,
  height: '160px',
  color: '#fff',
  lineHeight: '160px',
  textAlign: 'center',
  background: '#364d79',
};

const CarouselComponent = (props) => {
  const { images } = props
  
  return (
    <>
      <div style={{width:'800px', height:'600px', margin:'auto', marginTop: '20px' }}>
        <Carousel arrows prevArrow={<LeftOutlined />} nextArrow={<RightOutlined />} >
          {images.map((item, index) => {
            return <div key={index} style={{ width: '100%', height: '70%', margin: '10px' }}>
              <Image
                width={'100%'}
                preview={false}
                src={item}
              />
            </div>
          })}

        </Carousel>
      </div>
    </>
  )
}

export default CarouselComponent