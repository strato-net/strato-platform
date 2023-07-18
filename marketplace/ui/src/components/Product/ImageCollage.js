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
        <Row gutter={{ xs: 8, sm: 16 }} justify="space-around" align="middle">
          <Col span={18}>
            <Image
              width={'100%'}
              onClick={() => { handleImagePreview() }}
              preview={false}
              src={images[0]}
            />
          </Col>
          <Col span={6}>
            {/* <Row> */}
            {/* <Col span={24}> */}
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
            {/* </Col> */}
            {/* </Row> */}
          </Col>
        </Row>
      </div>

      <Modal
        title="Photos"
        centered
        open={open}
        onOk={() => setOpen(false)}
        onCancel={() => setOpen(false)}
        width={'100%'}
        height={'100%'}
        // style={{ padding: '0px', margin: '0px' }}
        footer={false}
      >
        <div >
          {images?.map((item, index) => {
            return <Image
              width={'80%'}
              onClick={() => { handleImagePreview() }}
              preview={false}
              src={item}
              key={index}
            />
          })}
        </div>

      </Modal>
    </>
  )
}

export default ImageCollage