import React, { useState } from 'react';
import { Col, Row, Modal, Image } from 'antd';

const ImageCollage = (props) => {
  const [open, setOpen] = useState(false);
  const { images } = props
  const handleImagePreview = () => {
    setOpen(true)
  }

  return (
    <>
      <div style={{ margin: '20px' }}>
        <Row
          gutter={{ xs: 8, sm: 16 }}
          justify="space-around"
          align="middle"
          style={{ cursor: "pointer" }}>
          <Col span={16}>
            <Image
              width={'100%'}
              onClick={() => { handleImagePreview() }}
              preview={false}
              src={images[0]}
            />
          </Col>
          <Col span={8}>
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
          </Col>
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
              <div style={{ padding: '20px' }}>
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