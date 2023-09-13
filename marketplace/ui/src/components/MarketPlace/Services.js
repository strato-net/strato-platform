import React, { useState } from 'react';
import { Tabs, Table, Input, Select, Button, DatePicker, Space, InputNumber, Row, Col, Typography } from 'antd';
import {
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
  PlusOutlined,
  DeleteOutlined,
  SaveOutlined,
  LockOutlined,
  CaretDownOutlined,
} from '@ant-design/icons';
import "./service.css"


const { TabPane } = Tabs;
const { Option } = Select;


const ServiceTable = () => {
  const [isEdit, setIsEdit] = useState(false)
  const initialData = [
    {
      key: '1',
      user: 'User 1',
      provider: 'Provider 1',
      membershipId: '12345',
      service: 'Service A',
      summary: 'Summary 1',
      date: '2023-09-12',
      comments: 'Comment 1',
      status: 'Status 1',
      pricePaid: '100',
      editable: false,
    },
    {
      key: '2',
      user: 'User 2',
      provider: 'Provider 2',
      membershipId: '67890',
      service: 'Service B',
      summary: 'Summary 2',
      date: '2023-09-13',
      comments: 'Comment 2',
      status: 'Status 2',
      pricePaid: '200',
      editable: false,
    },
    // Add more initial data as needed...
  ];
  const newRowSchema = {
    user: '',
    provider: '',
    membershipId: '',
    service: '',
    summary: '',
    date: null,
    comments: '',
    status: '',
    pricePaid: '',
    editable: true,
  }

  const [activeTab, setActiveTab] = useState('booked');
  const [dataBooked, setDataBooked] = useState(initialData);
  const [dataProvided, setDataProvided] = useState(initialData);
  const [newRow, setNewRow] = useState(newRowSchema);

  const handleTabChange = (key) => {
    setActiveTab(key);
  };

  const handleEdit = (key) => {
    setIsEdit(true)
    const data = activeTab === 'booked' ? dataBooked : dataProvided;
    const newData = [...data];
    const item = newData.find((item) => item.key === key);
    if (item) {
      item.editable = true;
      if (activeTab === 'booked') {
        setDataBooked(newData);
      } else {
        setDataProvided(newData);
      }
    }
  };

  const handleCancel = (key) => {
    const data = activeTab === 'booked' ? dataBooked : dataProvided;
    const newData = [...data];
    const item = newData.find((item) => item.key === key);
    if (item) {
      item.editable = false;
      if (activeTab === 'booked') {
        setDataBooked(newData);
      } else {
        setDataProvided(newData);
      }
    }
  };

  const handleUpdate = (key) => {
    const data = activeTab === 'booked' ? dataBooked : dataProvided;
    const newData = [...data];
    const item = newData.find((item) => item.key === key);
    if (item) {
      item.editable = false;
      if (activeTab === 'booked') {
        setDataBooked(newData);
      } else {
        setDataProvided(newData);
      }
    }
  };

  const handleDelete = (key) => {
    const data = activeTab === 'booked' ? dataBooked : dataProvided;
    const newData = data.filter((item) => item.key !== key);
    if (activeTab === 'booked') {
      setDataBooked(newData);
    } else {
      setDataProvided(newData);
    }
  };

  const handleInputChange = (e, field, key) => {
    const data = activeTab === 'booked' ? dataBooked : dataProvided;
    const newData = [...data];
    const item = newData.find((item) => item.key === key);
    if (item) {
      item[field] = e;
      if (activeTab === 'booked') {
        setDataBooked(newData);
      } else {
        setDataProvided(newData);
      }
    }
  };

  const handleDateChange = (date, dateString, key) => {
    const data = activeTab === 'booked' ? dataBooked : dataProvided;
    const newData = [...data];
    const item = newData.find((item) => item.key === key);
    if (item) {
      item.date = dateString;
      if (activeTab === 'booked') {
        setDataBooked(newData);
      } else {
        setDataProvided(newData);
      }
    }
  };

  const handleSelectChange = (value, field, key) => {
    const data = activeTab === 'booked' ? dataBooked : dataProvided;
    const newData = [...data];
    const item = newData.find((item) => item.key === key);
    if (item) {
      item[field] = value;
      if (activeTab === 'booked') {
        setDataBooked(newData);
      } else {
        setDataProvided(newData);
      }
    }
  };

  const handleAddRow = () => {
    setIsEdit(false)
    const data = activeTab === 'booked' ? dataBooked : dataProvided;
    const newData = [...data];
    const newKey = (Math.random() * 1000).toString();
    newData.push({
      key: newKey,
      ...newRow,
    });
    if (activeTab === 'booked') {
      setDataBooked(newData);
    } else {
      setDataProvided(newData);
    }
    setNewRow(newRowSchema);
  };

  const handleSave = () => {
    let data = activeTab === 'booked' ? dataBooked : dataProvided;
    data = data.map((item, index) => {
      item['editable'] = false;
      return item
    })
    if (activeTab === 'booked') {
      setDataBooked(data)
    } else {
      setDataProvided(data)
    }
  }


  const columns = [
    {
      title: 'User',
      dataIndex: 'user',
      key: 'user',
      render: (text, record) => (
        <span>
          {record.editable && !isEdit ? (
            <Select
              placeholder="User"
              suffixIcon={activeTab === "booked" ? <LockOutlined /> : <CaretDownOutlined />}
              disabled={activeTab === "booked"}
              style={{ width: 120 }}
              onChange={(value) => handleSelectChange(value, 'user', record.key)}
              options={[
                { value: 'jack', label: 'Jack' },
                { value: 'lucy', label: 'Lucy' },
              ]}
            />
          ) : (
            <span>
              {text}
              {/* {activeTab === "booked" && <LockOutlined />} */}
            </span>
          )}
        </span>
      ),
    },
    {
      title: 'Provider',
      dataIndex: 'provider',
      key: 'provider',
      render: (text, record) => (
        <span>
          {record.editable && !isEdit ? (
            <Select
              placeholder="Provider"
              suffixIcon={activeTab === "provided" ? <LockOutlined /> : <CaretDownOutlined />}
              disabled={activeTab === "provided"}
              style={{ width: 120 }}
              onChange={(value) => handleSelectChange(value, 'provider', record.key)}
              options={[
                { value: 'BOXR', label: 'BOXR' },
                { value: 'Eqinox', label: 'Eqinox' },
              ]}
            />
          ) : (
            <span>
              {text}
              {/* {activeTab === "provided" && <LockOutlined />} */}
            </span>
          )}
        </span>
      ),
    },
    {
      title: 'Membership ID',
      dataIndex: 'membershipId',
      key: 'membershipId',
      render: (text, record) => (
        <span>
          {record.editable && !isEdit ? (
            <Select
              placeholder="Membership ID"
              suffixIcon={<CaretDownOutlined />}
              style={{ width: 120 }}
              onChange={(value) => handleSelectChange(value, 'membershipId', record.key)}
              options={[
                { value: 'AB1', label: 'AB1' },
                { value: 'BC2', label: 'BC2' },
              ]}
            />
          ) : (
            <span>
              {text}
            </span>
          )}
        </span>
      ),
    },
    {
      title: 'Service',
      dataIndex: 'service',
      key: 'service',
      render: (text, record) => (
        <span>
          {record.editable && !isEdit ? (
            <Select
              placeholder="Service"
              suffixIcon={<CaretDownOutlined />}
              style={{ width: 120 }}
              onChange={(value) => handleSelectChange(value, 'service', record.key)}
              options={[
                { value: 'crossfit', label: 'crossfit' },
                { value: 'personal training', label: 'personal training' },
              ]}
            />
          ) : (
            <span>
              {text}
            </span>
          )}
        </span>
      ),
    },
    {
      title: 'Summary',
      dataIndex: 'summary',
      key: 'summary',
      render: (text, record) => (
        <span>
          {record.editable ? (
            <Input value={text} suffix={<EditOutlined />} placeholder='Summary' onChange={(e) => handleInputChange(e.target.value, 'summary', record.key)} />
          ) : (
            text
          )}
        </span>
      ),
    },
    {
      title: 'Date',
      dataIndex: 'date',
      key: 'date',
      render: (text, record) => (
        <span>
          {record.editable && !isEdit ? (
            <DatePicker
              // value={text ? moment(text, 'YYYY-MM-DD') : null}
              onChange={(date, dateString) => handleDateChange(date, dateString, record.key)}
            />
          ) : (
            text
          )}
        </span>
      ),
    },
    {
      title: 'Comments',
      dataIndex: 'comments',
      key: 'comments',
      render: (text, record) => (
        <span>
          {record.editable ? (
            <Input value={text} suffix={<EditOutlined />} placeholder='Comments' onChange={(e) => handleInputChange(e.target.value, 'comments', record.key)} />
          ) : (
            text
          )}
        </span>
      ),
    },
    {
      title: 'Status',
      dataIndex: 'status',
      key: 'status',
      render: (text, record) => (
        <span>
          {record.editable ? (
            <Select value={text}
              placeholder="Status"
              suffixIcon={<CaretDownOutlined />}
              // disabled={activeTab === "provided"}
              style={{ minWidth: "100px" }}
              onChange={(value) => handleSelectChange(value, 'status', record.key)}>
              <Option value="requested">Requested</Option>
              <Option value="Cancelled">Cancelled</Option>
            </Select>
          ) : (
            text
          )}
        </span>
      ),
    },
    {
      title: 'Price Paid',
      dataIndex: 'pricePaid',
      key: 'pricePaid',
      render: (text, record) => (
        <span>
          {record.editable && !isEdit ? (
            <InputNumber keyboard={true} className='w-36' addonAfter={<EditOutlined />} min={0} controls={false} value={text} placeholder='Price Paid' onChange={(e) => handleInputChange(e, 'pricePaid', record.key)} />
          ) : (
            text
          )}
        </span>
      ),
    },
    {
      title: '',
      dataIndex: 'actions',
      key: 'actions',
      render: (_, record) => (
        <Space size="middle">
          {record.editable ? (
            <>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                onClick={() => handleUpdate(record.key)}
              />
              {isEdit && <Button type="default" icon={<CloseOutlined />} onClick={() => handleCancel(record.key)} />}
            </>
          ) : (
            <Button type="primary" icon={<EditOutlined />} onClick={() => handleEdit(record.key)} />
          )}
          <Button type="danger" icon={<DeleteOutlined />} onClick={() => handleDelete(record.key)} />
        </Space>
      ),
    },
  ];

  const Filter = () => {
    return <Col className='flex justify-between service-filter'>
      <Typography.Title level={4}>
        Service
      </Typography.Title>
      <span>
        <Select
          placeholder="Provider"
          suffixIcon={<CaretDownOutlined />}
          style={{ width: 120 }}
          options={[
            { value: 'jack', label: 'Jack' },
            { value: 'lucy', label: 'Lucy' },
          ]}
        />
        <Select
          placeholder="Status"
          className='ml-2'
          suffixIcon={<CaretDownOutlined />}
          style={{ width: 120 }}
          options={[
            { value: 'jack', label: 'Jack' },
            { value: 'lucy', label: 'Lucy' },
          ]}
        />
      </span>
    </Col>
  }

  return (
    <div>
      <Row className='mt-2'>
        <Col className='flex justify-between absolute right-20 mt-2 z-10' span={4}>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={handleAddRow}
          // disabled={!newRow.user || !newRow.provider}
          >
            Add Service Use
          </Button>
          <Button
            className='ml-2'
            style={{ backgroundColor: "green" }}
            type="primary"
            // icon={<SaveOutlined />}
            onClick={handleSave}
            disabled={!dataBooked.length && !dataProvided.length}
          >
            Save
          </Button>
        </Col>
      </Row>
      <Row>
        <Col span={22} className='m-auto'>
          <Tabs activeKey={activeTab} onChange={handleTabChange}>
            <TabPane tab="Booked" key="booked">
              {Filter()}
              <Table
                columns={columns}
                dataSource={dataBooked}
                pagination={false}
                rowKey="key"
              />
            </TabPane>
            <TabPane tab="Provided" key="provided">
              {Filter()}
              <Table
                columns={columns}
                dataSource={dataProvided}
                pagination={false}
                rowKey="key"
              />
            </TabPane>
          </Tabs>
        </Col>
      </Row>
    </div>
  );
};

export default ServiceTable;
