import React, { useState, useEffect } from 'react';
import { Button, Col, Row, Tabs, Form, Input, Select, Typography, Space, DatePicker, Table } from 'antd';
import { EditOutlined, LockOutlined, DeleteOutlined } from "@ant-design/icons";
import "../Membership/membership.css";

const { TabPane } = Tabs;

const ServiceTable = ({ data, onDataChange, lockedField }) => {
  const [form] = Form.useForm();
  const { Option } = Select;

  const isEditing = (record) => record.key === 'new';

  const edit = () => {
    form.setFieldsValue({
      User: '',
      membership_id: '',
      service: '',
      status: '',
      summary: '',
      comments: '',
      price_Paid: '',
      date: null,
    });
    onDataChange([...data, { key: 'new' }]);
  };

  const deleteRow = () => {
    onDataChange(data.filter((item) => item.key !== 'new'));
  };

  const save = async () => {
    try {
      const row = await form.validateFields();
      onDataChange([...data, { ...row, key: String(data.length + 1) }]);
    } catch (err) {
      console.error('Validation failed:', err);
    }
  };

  const columns = [
    {
      title: 'User',
      dataIndex: 'user',
      render: (_, record) => {
        if (isEditing(record)) {
          return (
            <Form.Item name="user" initialValue={record.user}>
              <Input prefix={lockedField === 'user' && <LockOutlined />} disabled={lockedField === 'user'} />
            </Form.Item>
          );
        }
        return record.user;
      },
    },
    {
      title: 'Provider',
      dataIndex: 'Provider',
      render: (_, record) => {
        if (isEditing(record)) {
          return (
            <Form.Item name="Provider" initialValue={record.Provider}>
              <Input prefix={lockedField === 'Provider' && <LockOutlined />} disabled={lockedField === 'Provider'} />
            </Form.Item>
          );
        }
        return <LockOutlined />;
      },
    },
    {
      title: 'Membership ID',
      dataIndex: 'membership_id',
      render: (_, record) => {
        if (isEditing(record)) {
          return (
            <Form.Item name="membership_id" initialValue={record.membership_id}>
              <Input disabled={lockedField === 'membership_id'} />
            </Form.Item>
          );
        }
        return <LockOutlined />;
      },
    },
    {
      title: 'Service',
      dataIndex: 'service',
      render: (_, record) => {
        if (isEditing(record)) {
          return (
            <Form.Item name="service" initialValue={record.service}>
              <Select disabled={lockedField === 'service'}>
                <Option value="service1">service1</Option>
                <Option value="service2">service2</Option>
                {/* Add more service options as needed */}
              </Select>
            </Form.Item>
          );
        }
        return record.service;
      },
    },
    {
      title: 'Summary',
      dataIndex: 'summary',
      render: (_, record) => {
        if (isEditing(record)) {
          return (
            <Form.Item name="summary" initialValue={record.summary}>
              <Input />
            </Form.Item>
          );
        }
        return record.summary;
      },
    },
    {
      title: 'Date',
      dataIndex: 'date',
      render: (_, record) => {
        if (isEditing(record)) {
          return (
            <Form.Item name="date" initialValue={record.date}>
              <DatePicker />
            </Form.Item>
          );
        }
        return record.date;
      },
    },
    {
      title: 'Comments',
      dataIndex: 'comments',
      render: (_, record) => {
        if (isEditing(record)) {
          return (
            <Form.Item name="comments" initialValue={record.comments}>
              <Input />
            </Form.Item>
          );
        }
        return record.comments;
      },
    },
    {
      title: 'Status',
      dataIndex: 'status',
      render: (_, record) => {
        if (isEditing(record)) {
          return (
            <Form.Item name="status" initialValue={record.status}>
              <Select>
                <Option value="Status1">Status1</Option>
                <Option value="Status2">Status2</Option>
                {/* Add more status options as needed */}
              </Select>
            </Form.Item>
          );
        }
        return record.status;
      },
    },
    {
      title: 'Price Paid',
      dataIndex: 'price_Paid',
      render: (_, record) => {
        if (isEditing(record)) {
          return (
            <Form.Item name="price_Paid" initialValue={record.price_Paid}>
              <Input />
            </Form.Item>
          );
        }
        return record.price_Paid;
      },
    },
    {
      title: 'Action',
      dataIndex: 'action',
      render: (_, record) => {
        const editable = isEditing(record);
        if (editable) {
          return (
            <Col className='flex justify-between'>
              <Button onClick={save} type="primary" >
                Save
              </Button>
              <Button onClick={deleteRow} type="default">
                Cancel
              </Button>
            </Col>
          );
        }
        return (
          <Button onClick={edit} type="default" >
            <EditOutlined />
          </Button>
        );
      },
    },
  ];

  return (
    <Form form={form} component={false}>
      <Table
        className='membership-table'
        dataSource={data}
        columns={columns}
        rowKey="key"
        bordered
        pagination={false}
        footer={() => (
          <Button onClick={edit} type="primary">
            Add Service Use
          </Button>
        )}
      />
    </Form>
  );
};

const Services = () => {
  const [data, setData] = useState([]);
  const [lockedField, setLockedField] = useState('user');

  useEffect(() => {
    // Initialize your data here if needed
  }, []);

  const handleDataChange = (newData) => {
    setData(newData);
  };

  const handleTabChange = (key) => {
    if (key === '1') {
      setLockedField('Provider');
    } else if (key === '2') {
      setLockedField('user');
    }
  };

  return (
    <>
      {/* common code for adding new row for both tabs */}
      {/* <Row>
        <Col span={6} className="flex justify-between absolute right-24 mt-4">
          <Button type="primary" onClick={() => handleDataChange([...data, { key: 'new' }])}>
            Add Service Use
          </Button>
        </Col>
      </Row> */}
      <Row>
        <Col span={22} className="m-auto">
          <Tabs defaultActiveKey="1" size="large" tabBarGutter={30} onChange={handleTabChange}>
            <TabPane tab="Booked" key="1">
              <ServiceTable data={data} onDataChange={handleDataChange} lockedField={lockedField} />
            </TabPane>
            <TabPane tab="Provided" key="2">
              <ServiceTable data={data} onDataChange={handleDataChange} lockedField={lockedField} />
            </TabPane>
          </Tabs>
        </Col>
      </Row>
    </>
  );
};

export default Services;
