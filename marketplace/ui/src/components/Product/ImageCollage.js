import React, { useState } from 'react';
import { Col, Row, Modal, Image } from 'antd';
import CarouselComponent from './Carousel';

const ImageCollage = (props) => {
  const [open, setOpen] = useState(false);
  const { images } = props
  const handleImagePreview = () => {
    setOpen(true)
  }

  return (
    <>
      <div className='h-600 w-800 m-auto mt-5'>
        <Row
          gutter={{ xs: 8, sm: 16 }}
          justify="space-around"
          align="middle"
          className='cursor-pointer'>
          <Col span={16}>
            <CarouselComponent images={images} />
          </Col>
          {images.length >= 3
            && <Col span={8}>
              <Image
                width={'100%'}
                onClick={() => { handleImagePreview() }}
                preview={false}
                src={images[1]}
              />
              <Image
                width={'100%'}
                onClick={() => { handleImagePreview() }}
                preview={false}
                src={images[2]}
              />
              <div className='img-count' onClick={() => { handleImagePreview() }} >
                {images?.length} Photos
              </div>
            </Col>
          }
        </Row>
      </div>

      <Modal
        title="Photos"
        centered
        open={open}
        onOk={() => setOpen(false)}
        onCancel={() => setOpen(false)}
        width={'90%'}
        height={'90%'}
        footer={false}
      >
        <div >
          {images?.map((item, index) => {
            return (
              <div className='p-5'>
                <Image
                  width={'100%'}
                  onClick={() => { handleImagePreview() }}
                  preview={false}
                  src={item}
                  key={index}
                />
              </div>
            )
          })}
        </div>
      </Modal>
    </>
  )
}

export default ImageCollage;
