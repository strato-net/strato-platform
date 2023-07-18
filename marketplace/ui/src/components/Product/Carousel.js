import React from 'react'
import { Carousel, Image } from 'antd';
import { RightOutlined, LeftOutlined  } from "@ant-design/icons";

const contentStyle = {
  margin: 0,
  height: '160px',
  color: '#fff',
  lineHeight: '160px',
  textAlign: 'center',
  background: '#364d79',
};

// const contentStyle = {
//   height: '160px',
//   color: '#fff',
//   lineHeight: '160px',
//   textAlign: 'center',
//   background: '#364d79'
// }

// from https://react-slick.neostack.com/docs/example/custom-arrows
const SampleNextArrow = props => {
  const { className, style, onClick } = props
  return (
    <div
      className={className}
      style={{ ...style, display: 'block', background: 'red' }}
      onClick={onClick}
    />
  )
}

const SamplePrevArrow = props => {
  const { className, style, onClick } = props
  return (
    <div
      className={className}
      style={{ ...style, display: 'block', background: 'green' }}
      onClick={onClick}
    />
  )
}

const settings = {
  nextArrow: <SampleNextArrow />,
  prevArrow: <SamplePrevArrow />
}


const CarouselComponent = (props) => {

 const {images} = props

  const onChange = (currentSlide) => {
    console.log(currentSlide);
  };

  return (
   <>
   {/* <div style={{marginTop:'20px'}}>
   <Carousel arrows {...settings} afterChange={onChange}>
      {images.map((item, index)=>{
        return <div key={index} style={{width:'100%', height:'70%', margin:'10px'}}>
        <Image
            width={'100%'}
            // onClick={() => { handleImagePreview() }}
            preview={false}
            src={item}
          />
      </div>
      })}
      
    </Carousel>
   </div> */}

     <div style={{marginTop:'20px'}}>
   <Carousel arrows {...settings} afterChange={onChange}>
      {images.map((item, index)=>{
        return <div key={index} style={{width:'100%', height:'70%', margin:'10px'}}>
        <Image
            width={'100%'}
            // onClick={() => { handleImagePreview() }}
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