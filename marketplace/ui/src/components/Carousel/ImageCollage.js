import React, { useState } from 'react';
import { Col, Row, Modal, Image, Button } from 'antd';
import CarouselComponent from './Carousel';
import { FileImageOutlined } from "@ant-design/icons";

const ImageCollage = (props) => {
  const [open, setOpen] = useState(false);
  const { images } = props
  const handleImagePreview = () => {
    setOpen(true)
  }

  return (
    <>
      <div style={{ margin: 'auto', marginTop: '20px' }}>
        <Row
          gutter={{ xs: 8, sm: 16 }}
          justify="space-around"
          align="middle"
          style={{ cursor: "pointer" }}>
          <Col span={16}>
            <CarouselComponent images={images} />
          </Col>
          {images?.length >= 3
            && <Col span={8}>
              <Image
                width={'100%'}
                preview={false}
                src={images[1]}
              />
              <Image
                width={'100%'}
                preview={false}
                src={images[2]}
              />
              <Button type='default' className='img-count' onClick={() => { handleImagePreview() }} >
                <FileImageOutlined />{images?.length} Photos
              </Button>
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
              <div style={{ padding: '20px' }} key={index} >
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

export default ImageCollage