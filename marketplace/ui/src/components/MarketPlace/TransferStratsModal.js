import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Button, Card, Col, Input, InputNumber, Modal, Row, Spin } from 'antd';
import {
  useMarketplaceDispatch,
  useMarketplaceState
} from "../../contexts/marketplace";
import { actions } from "../../contexts/marketplace/actions";
import Column from 'antd/es/table/Column';

const TransferStratsModal = ({ visible, onCancel }) => {
  
  //Dispatch
  const marketplaceDispatch = useMarketplaceDispatch();
  const { isTransferringStrats } = useMarketplaceState();
  
  const [receiverAddress, setReceiverAddress] = useState('');
  const [amount, setAmount] = useState(0);
  
  const handleChange = (value) => {
    setAmount(value);
  }

  const handleSelect = (value, option) => {
    setReceiverAddress(value)
  }

  const onChange = (e) => {
    setReceiverAddress(e.target.value)
  }
  
  const handleSubmit = async () => {
    const payload = {
      to: receiverAddress,
      value: amount !== undefined ? amount * 100 : 0
    }
    await actions.transferStrats(marketplaceDispatch, payload);
    onCancel();
  };

  return (
      <Modal
          title="Transfer STRATs"
          open={visible}
          onCancel={onCancel}
          footer={[
              <Button key="back" onClick={onCancel}>
                  Cancel
              </Button>,
              <Button key="submit" type="primary" onClick={handleSubmit} disabled={isTransferringStrats}>
                Submit
              </Button>,
          ]}
      >
        <Card style={{ height: 200 }}>
          <div style={{ display: 'flex', alignItems: 'center', flexDirection: 'column', justifyContent: 'center' }}>
            <Row>
              To
              <Input onChange={onChange} placeholder='Recipient address' />
              {/* <Select
                style={{ width: '20rem', marginBottom: '10px' }}
                placeholder={'Select Recipient'}
                showSearch
                size="large"
                onSelect={handleSelect}
                options={filteredDupUsersList}
                optionFilterProp="value"
                filterOption={(input, option) =>
                  (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
                }
              /> */ }
            </Row>
            <Row>
              Amount
              <InputNumber
                style={{ width: '20rem', marginBottom: '10px' }}
                controls={false}
                size={"large"}
                min={0.00}
                precision={2}
                defaultValue={amount}
                onChange={(e) => handleChange(e)}
                value={amount}
              />
            </Row>
          </div>
        </Card>
      </Modal>
  );
};

export default TransferStratsModal;
