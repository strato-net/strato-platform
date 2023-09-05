import React, { useState } from 'react'
import { Row, Col, Card, Button, Modal } from 'antd';
// import BookingModal from './BookingModal';

function ListingContactCard() {
  const [isModalOpen, setIsModalOpen] = useState(false);

  const showModal = () => {
    setIsModalOpen(true);
  };

  const handleOk = () => {
    setIsModalOpen(false);
  };

  const handleCancel = () => {
    setIsModalOpen(false);
  };
  return (
    <Card style={{ backgroundColor: '#D9D9D9', marginTop: 25, marginLeft: 10 }}>
      <Row justify={'center'}>
        <Button type='default' style={{ width: 200, marginBottom: 10 }} disabled>Book Tour</Button>
      </Row>
      <Row justify={'center'}>
        <Button style={{ width: 200, marginBottom: 10 }} disabled>Make an Offer</Button>
      </Row>
      <Row justify={'center'}>
        <Button type='primary' style={{ width: 200 }} onClick={showModal}>Talk to Sales</Button>
      </Row>

      <Modal open={isModalOpen} okText={'Done'} onOk={handleOk} onCancel={handleCancel}>
        {/* <BookingModal /> */}
      </Modal>
    </Card>
  )
}

export default ListingContactCard
