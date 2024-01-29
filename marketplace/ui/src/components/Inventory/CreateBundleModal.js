import React from 'react';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal, Select, Space } from 'antd';

const onFinish = (values) => {
    console.log('Received values of form:', values);
};
const CreateBundleModal = (open, handleCancel) => (

    <Modal open={open} onCancel={handleCancel} okButtonProps={{ hidden: true }} cancelButtonProps={{ hidden: true }}>
        <h1 className=" font-semibold text-lg text-[#202020]">
            Create Bundle
        </h1>
        <hr className="text-secondryD mt-3 mb-4" />
        <Form
            name="dynamic_form_nest_item"
            onFinish={onFinish}
            style={{
                maxWidth: 600,
            }}
            autoComplete="off"
        >
            <Form.List name="users">
                {(fields, { add, remove }) => (
                    <>
                        {fields.map(({ key, name, ...restField }) => (
                            <Space
                                key={key}
                                style={{
                                    display: 'flex',
                                    marginBottom: 8,
                                }}
                                align="baseline"
                            >
                                <Form.Item
                                    className='mr-10 h-12 mb-4'
                                    {...restField}
                                    name={[name, 'first']}
                                    rules={[
                                        {
                                            required: true,
                                            message: 'Missing first name',
                                        },
                                    ]}
                                >
                                    <Select placeholder="Asset" />
                                </Form.Item>
                                <Form.Item
                                    className='h-12'
                                    {...restField}
                                    name={[name, 'last']}
                                    rules={[
                                        {
                                            required: true,
                                            message: 'Missing last name',
                                        },
                                    ]}
                                >
                                    <Input placeholder="Quantity" />
                                </Form.Item>
                                <MinusCircleOutlined onClick={() => remove(name)} />
                            </Space>
                        ))}
                        <Form.Item>
                            <Button type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                                Add field
                            </Button>
                        </Form.Item>
                        <div className='flex justify-between gap-4'>
                            <Input placeholder="Bundle price" className='mt-4 w-48' />
                            <Input placeholder="Bundle quantity" className='mt-4 w-48' />
                        </div>
                    </>
                )}
            </Form.List>
            <Form.Item>
                <Button type="primary" htmlType="submit" className='mt-4'>
                    Create Bundle
                </Button>
            </Form.Item>
        </Form>
    </Modal>
);


export default CreateBundleModal;