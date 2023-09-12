import React, { useState } from 'react';
import { Button, Col, Row, Tabs, Table, Form, Input, Select, Typography, Space } from 'antd'
import { EditOutlined } from "@ant-design/icons"
import "../Membership/membership.css"

const ServiceTable = () => {
  const [form] = Form.useForm();
  const { Option } = Select;

  const [data, setData] = useState([
    {
      key: '1',
      User: 'User1',
      Provider: 'Provider1',
      Membership_id: '123',
      Service: 'Service1',
      Summary: 'Summary1',
      Date: '2023-09-11',
      Comments: 'Comments1',
      Status: 'Status1',
      Price_Paid: 100,
    },
    // Add more rows as needed
  ]);
  const [editingKey, setEditingKey] = useState('');

  const isEditing = (record) => record.key === editingKey;

  const edit = (record) => {
    form.setFieldsValue({
      Summary: '',
      Comments: '',
      Status: '',
      ...record,
    });
    setEditingKey(record.key);
  };

  const cancel = () => {
    setEditingKey('');
  };

  const save = async (key) => {
    try {
      const row = await form.validateFields();
      const newData = [...data];
      const index = newData.findIndex((item) => key === item.key);

      if (index > -1) {
        const item = newData[index];
        newData.splice(index, 1, { ...item, ...row });
        setData(newData);
        setEditingKey('');
      }
    } catch (err) {
      console.error('Validation failed:', err);
    }
  };

  const columns = [
    {
      title: 'User',
      dataIndex: 'User',
    },
    {
      title: 'Provider',
      dataIndex: 'Provider',
    },
    {
      title: 'Membership ID',
      dataIndex: 'Membership_id',
    },
    {
      title: 'Service',
      dataIndex: 'Service',
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
    },
    {
      title: 'Action',
      dataIndex: 'action',
      render: (_, record) => {
        const editable = isEditing(record);
        return editable ? (
          <span>
            <Button onClick={() => save(record.key)} type="primary">
              Save
            </Button>
            <Button onClick={cancel} type="default">
              Cancel
            </Button>
          </span>
        ) : (
          <Button onClick={() => edit(record)} type="default">
            <EditOutlined />
          </Button>
        );
      },
    },
  ];

  return (
    <>
      <Col span={24} className="mx-auto p-4 border border-indigo-600 rounded-lg">
        <Col className="flex justify-between">
          <Typography.Title level={4} className="ml-2 ">Service Usage</Typography.Title>
          <Space wrap className="service-filter">
            <Select
              // defaultValue="User"
              placeholder="User"
              style={{ width: 120 }}
              className="border-0"
              // onChange={handleChange}
              options={[
                { value: 'option 1', label: 'option 1' },
                { value: 'Option 2', label: 'Option 2' },
              ]}
            />
            <Select
              // defaultValue="Status"
              placeholder="Status"
              style={{ width: 120 }}
              // onChange={handleChange}
              options={[
                { value: 'status 1', label: 'status 1' },
                { value: 'status 2', label: 'status 2' },
              ]}
            />
          </Space>
        </Col>
        <Form form={form} component={false}>
          <Table
            className='membership-table'
            dataSource={data}
            columns={columns}
            rowKey="key"
            bordered
            pagination={false}
          />
        </Form>
      </Col>
    </>

  );
};

const Services = () => {

  const items = [
    {
      key: '1',
      label: 'Booked',
      children: <ServiceTable />,
    },
    {
      key: '2',
      label: 'Provided',
      children: <ServiceTable />,
    }
  ];

  const onChange = (key) => {
    console.log(key);
  };


  return (
    <>
      <Row>
        <Col span={6} className="flex justify-between absolute right-24 mt-4">
          <Button type="primary">Add Service Use</Button>
          <Button className="bg-green-600 ml-2">Save</Button>
        </Col>
      </Row>
      <Row>
        <Col span={22} className="m-auto">
          <Tabs defaultActiveKey="1" size="large" tabBarGutter={30} items={items} onChange={onChange} />
        </Col>
      </Row>
    </>
  )
}

export default Services