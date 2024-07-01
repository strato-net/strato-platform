import { Button, Col, Row } from 'antd'
import React from 'react'
import products from "../../images/bannerImages/products.png";


const Banner2 = () => {
  return (
    <Row>
      <Col xs={12} className='flex justify-center items-center h-[360px] w-full' >
        <div>
          <p className='text-[32px] md:text-[48px] w-[70%] text-left font-bold'>
          Step into the Future With Tokenized Clothing
          </p>
          <div className="flex relative mt-8 z-50">
            <Button
              id="viewMore"
              onClick={() => {
                // navigate(navRoute);
                // sessionStorage.setItem('scrollPosition', 0);
              }}
              className="gradient-button h-auto md:h-11 border-primary bg-white text-primary hover:text-white"
            >
              <div className="flex items-center">
                <div className="hidden md:block font-semibold text-lg">
                  Explore More
                </div>
                <div className="md:hidden font-semibold text-base">
                  Explore
                </div>
                {/* <img src={Images.button_arrow} /> */}
              </div>
            </Button>
          </div>
        </div>
      </Col>
      <Col xs={12} className='flex justify-center items-center' style={{ height: "360px", width: '100%' }} >
        <div style={{ height: '80%' }}>
          <img src={products} style={{ width: '455px', height: '280px' }} />
        </div>
      </Col>
    </Row>
  )
}

export default Banner2;
