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
      Membership_id: '',
      Service: '',
      Status: '',
      Summary: '',
      Comments: '',
      Price_Paid: '',
      Date: null,
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
      dataIndex: 'User',
      render: (_, record) => {
        if (isEditing(record)) {
          return (
            <Form.Item name="User" initialValue={record.User}>
              <Input prefix={lockedField === 'User' && <LockOutlined />} disabled={lockedField === 'User'} />
            </Form.Item>
          );
        }
        return record.User;
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
      dataIndex: 'Membership_id',
      render: (_, record) => {
        if (isEditing(record)) {
          return (
            <Form.Item name="Membership_id" initialValue={record.Membership_id}>
              <Input disabled={lockedField === 'Membership_id'} />
            </Form.Item>
          );
        }
        return <LockOutlined />;
      },
    },
    {
      title: 'Service',
      dataIndex: 'Service',
      render: (_, record) => {
        if (isEditing(record)) {
          return (
            <Form.Item name="Service" initialValue={record.Service}>
              <Select disabled={lockedField === 'Service'}>
                <Option value="Service1">Service1</Option>
                <Option value="Service2">Service2</Option>
                {/* Add more service options as needed */}
              </Select>
            </Form.Item>
          );
        }
        return record.Service;
      },
    },
    {
      title: 'Summary',
      dataIndex: 'Summary',
      render: (_, record) => {
        if (isEditing(record)) {
          return (
            <Form.Item name="Summary" initialValue={record.Summary}>
              <Input />
            </Form.Item>
          );
        }
        return record.Summary;
      },
    },
    {
      title: 'Date',
      dataIndex: 'Date',
      render: (_, record) => {
        if (isEditing(record)) {
          return (
            <Form.Item name="Date" initialValue={record.Date}>
              <DatePicker />
            </Form.Item>
          );
        }
        return record.Date;
      },
    },
    {
      title: 'Comments',
      dataIndex: 'Comments',
      render: (_, record) => {
        if (isEditing(record)) {
          return (
            <Form.Item name="Comments" initialValue={record.Comments}>
              <Input />
            </Form.Item>
          );
        }
        return record.Comments;
      },
    },
    {
      title: 'Status',
      dataIndex: 'Status',
      render: (_, record) => {
        if (isEditing(record)) {
          return (
            <Form.Item name="Status" initialValue={record.Status}>
              <Select>
                <Option value="Status1">Status1</Option>
                <Option value="Status2">Status2</Option>
                {/* Add more status options as needed */}
              </Select>
            </Form.Item>
          );
        }
        return record.Status;
      },
    },
    {
      title: 'Price Paid',
      dataIndex: 'Price_Paid',
      render: (_, record) => {
        if (isEditing(record)) {
          return (
            <Form.Item name="Price_Paid" initialValue={record.Price_Paid}>
              <Input />
            </Form.Item>
          );
        }
        return record.Price_Paid;
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
  const [lockedField, setLockedField] = useState('User');

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
      setLockedField('User');
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
