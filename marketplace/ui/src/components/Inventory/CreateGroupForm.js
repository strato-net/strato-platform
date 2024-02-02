import React, { useState, useEffect } from 'react';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import { Button, Form, Input, Select, Upload, notification } from 'antd';
import TextArea from "antd/es/input/TextArea";
import { useInventoryDispatch, useInventoryState, } from "../../contexts/inventory";
import { actions } from "../../contexts/inventory/actions";

const CreateGroupForm = ({ handleCancel }) => {
    const [form] = Form.useForm();
    const { Option } = Select;
    const [selectedImages, setSelectedImages] = useState(null);
    const [selectedFiles, setSelectedFiles] = useState(null);
    const [uploadErr, setUploadErr] = useState("");
    const [api, contextHolder] = notification.useNotification();
    const dispatch = useInventoryDispatch();
    const {
        inventories,
        isUploadImageSubmitting,
        isCreatingAssetGroup,
        stripeStatus,
        message,
        success
    } = useInventoryState();

    useEffect(() => {
        actions.fetchInventory(dispatch, 10000, 0, "");
    }, [dispatch]);

    const beforeImageUpload = (file) => {
        const isJpgOrPng = file.type === "image/jpeg" || file.type === "image/png";
        if (!isJpgOrPng) {
            setUploadErr("Image must be of jpeg or png format");
            return Upload.LIST_IGNORE;
        }
        const isLt1M = file.size / 1024 / 1024 < 1;
        if (!isLt1M) {
            setUploadErr("Cannot upload an image of size more than 1mb");
            return Upload.LIST_IGNORE;
        }
        const isNameLengthValid = file.name.length <= 100;
        if (!isNameLengthValid) {
            setUploadErr("File name must be less than 100 characters");
            return Upload.LIST_IGNORE;
        }
        setUploadErr("");
        return false
    };

    const handleImageChange = (info) => {
        setSelectedImages(info.fileList);
        form.setFieldValue("images", info.fileList.map((e) => e.originFileObj))
    };

    const beforeFileUpload = (file) => {
        const isPdf = file.type === "application/pdf";
        if (!isPdf) {
            setUploadErr("File must be PDF format");
            return Upload.LIST_IGNORE;
        }
        const isLt1M = file.size / 1024 / 1024 < 1;
        if (!isLt1M) {
            setUploadErr("Cannot upload a PDF of size more than 1mb");
            return Upload.LIST_IGNORE;
        }
        const isNameLengthValid = file.name.length <= 100;
        if (!isNameLengthValid) {
            setUploadErr("File name must be less than 100 characters");
            return Upload.LIST_IGNORE;
        }
        setUploadErr("");
        return false;
    };

    const handleFileChange = (info) => {
        setSelectedFiles(info.fileList);
        form.setFieldValue("files", info.fileList.map((e) => e.originFileObj))
    };

    const handleCreateFormSubmit = async (values) => {
        let imageKeys = []
        if (values.images && values.images.length > 0) {
            for (const img of values.images) {
                const formData = new FormData();
                formData.append(img.name, img);
                const imageData = await actions.uploadImage(dispatch, formData);
                if (imageData) {
                    imageKeys.push(imageData);
                } else {
                    throw new Error("Image upload failed");
                }
            }
        }

        let fileKeys = []
        if (values.files && values.files.length > 0) {
            for (const file of values.files) {
                const formData = new FormData();
                formData.append(file.name, file);
                const fileData = await actions.uploadImage(dispatch, formData);
                if (fileData) {
                    fileKeys.push(fileData);
                } else {
                    throw new Error("File upload failed");
                }
            }
        }

        const { firstAsset, firstQuantity, secondAsset, secondQuantity, assets, images, files, ...restOfValues } = values;
        assets.push(
            {
                assetAddress: firstAsset,
                assetQuantity: firstQuantity
            },
            {
                assetAddress: secondAsset,
                assetQuantity: secondQuantity
            }
        );

        const body = {
            ...restOfValues,
            assets,
            images: imageKeys || [],
            files: fileKeys || [],
            paymentProviders: stripeStatus ? [stripeStatus.paymentProviderAddress] : []
        };

        console.log('Received values of form:', body);

        let isDone = await actions.createAssetGroup(dispatch, body);

        if (isDone) {
            await actions.fetchInventory(dispatch, 10, 0, "", "");
            handleCancel();
        }
    };

    const openToast = (placement) => {
        if (success) {
            api.success({
                message: message,
                onClose: actions.resetMessage(dispatch),
                placement,
                key: 1,
            });
        } else {
            api.error({
                message: message,
                onClose: actions.resetMessage(dispatch),
                placement,
                key: 2,
            });
        }
    };

    return (
        <>
            {contextHolder}
            <Form
                form={form}
                className='inventory_modal'
                layout="vertical"
                initialValues={{
                    firstAsset: "",
                    secondAsset: "",
                    firstQuantity: 1,
                    secondQuantity: 1,
                    assets: [],
                    name: "",
                    price: 1,
                    description: "",
                    images: [],
                    files: [],
                }}
            >
                <div className='grid grid-cols-1 md:grid-cols-2 gap-4 mt-4'>
                    <Form.Item
                        label="Group Name"
                        name="name"
                        rules={[
                            {
                                required: true,
                                message: 'Please enter a group name',
                            },
                        ]}
                    >
                        <Input placeholder="Enter group name" />
                    </Form.Item>
                    <Form.Item
                        label="Group Price"
                        name="price"
                        rules={[
                            {
                                required: true,
                                message: 'Please enter a group price',
                            },
                        ]}
                    >
                        <Input placeholder="Enter group price" />
                    </Form.Item>
                </div>
                <div className="flex justify-between mt-4 ">
                    <Form.Item
                        label="Description"
                        name="description"
                        className="w-full"
                        rules={[
                            {
                                required: true,
                                message: 'Please enter a description',
                            },
                        ]}
                    >
                        <TextArea placeholder="Enter Description" />
                    </Form.Item>
                </div>
                <div className="mt-4 flex-wrap gap-5 sm:flex-nowrap flex justify-between">
                    <Form.Item
                        label="Upload Images"
                        name="images"
                        className="w-full sm:w-[200px] md:w-72"
                        rules={[
                            {
                                required: true,
                                message: 'Please upload an image',
                            },
                        ]}
                    >
                        <div className="p-4 border-secondryD border rounded flex flex-col justify-around">
                            <Upload
                                onChange={handleImageChange}
                                fileList={selectedImages}
                                accept="image/png, image/jpeg"
                                multiple={true}
                                maxCount={10}
                                beforeUpload={beforeImageUpload}
                                listType="picture"
                            >
                                <div className="text-primary border border-primary rounded px-4 py-2 text-center hover:text-white hover:bg-primary cursor-pointer">
                                    Browse Images
                                </div>
                            </Upload>
                        </div>

                        <div className="flex items-start">
                            <p className="mt-1 text-xs italic font-medium ">Note:</p>
                            <p className="mt-1 text-xs italic ml-1 mr-4">
                                use jpg, png format of size less than 1mb. Limit of 10.
                            </p>
                        </div>
                    </Form.Item>
                    <Form.Item
                        label="Upload Files"
                        name="files"
                        className="w-full sm:w-[200px] md:w-72"
                    >
                        <div className="p-4 border-secondryD border rounded flex flex-col justify-around">
                            <Upload
                                onChange={handleFileChange}
                                fileList={selectedFiles}
                                accept="application/pdf"
                                multiple={true}
                                maxCount={10}
                                beforeUpload={beforeFileUpload}
                            >
                                <div className="text-primary border border-primary rounded px-4 py-2 text-center hover:text-white hover:bg-primary cursor-pointer">
                                    Browse Files
                                </div>
                            </Upload>
                        </div>

                        <div className="flex items-start">
                            <p className="mt-1 text-xs italic font-medium ">Note:</p>
                            <p className="mt-1 text-xs italic ml-1 mr-4">
                                use pdf format of size less than 1mb. Limit of 10.
                            </p>
                        </div>
                    </Form.Item>
                </div>
                <div className='grid grid-cols-1 md:grid-cols-2 gap-4 mt-4'>
                    <Form.Item
                        label="Asset"
                        name="firstAsset"
                        rules={[
                            {
                                required: true,
                                message: 'Please select an Asset',
                            },
                        ]}
                    >
                        <Select
                            placeholder="Select Asset"
                            allowClear
                            showSearch
                        >
                            {inventories.map((e, index) => (
                                <Option value={e.address} key={index}>
                                    {e.name}
                                </Option>
                            ))}
                        </Select>
                    </Form.Item>
                    <Form.Item
                        label="Quantity"
                        name='firstQuantity'
                        rules={[
                            {
                                required: true,
                                message: 'Please input a quantity',
                            },
                        ]}
                    >
                        <Input placeholder="Quantity" />
                    </Form.Item>
                </div>
                <div className='grid grid-cols-1 md:grid-cols-2 gap-4 mt-4'>
                    <Form.Item
                        label="Asset"
                        name="secondAsset"
                        rules={[
                            {
                                required: true,
                                message: 'Please select an Asset',
                            },
                        ]}
                    >
                        <Select
                            placeholder="Select Asset"
                            allowClear
                            showSearch
                        >
                            {inventories.map((e, index) => (
                                <Option value={e.address} key={index}>
                                    {e.name}
                                </Option>
                            ))}
                        </Select>
                    </Form.Item>
                    <Form.Item
                        label="Quantity"
                        name='secondQuantity'
                        rules={[
                            {
                                required: true,
                                message: 'Please input a quantity',
                            },
                        ]}
                    >
                        <Input placeholder="Quantity" />
                    </Form.Item>
                </div>
                <Form.List name="assets">
                    {(fields, { add, remove }) => (
                        <>
                            {fields.map(({ key, name, ...restField }) => (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                                    <Form.Item
                                        label="Asset"
                                        {...restField}
                                        name={[name, 'assetAddress']}
                                        rules={[
                                            {
                                                required: true,
                                                message: 'Please select an asset',
                                            },
                                        ]}
                                    >
                                        <Select
                                            placeholder="Select Asset"
                                            allowClear
                                            showSearch
                                        >
                                            {inventories.map((e, index) => (
                                                <Option value={e.address} key={index}>
                                                    {e.name}
                                                </Option>
                                            ))}
                                        </Select>
                                    </Form.Item>
                                    <Form.Item
                                        label="Quantity"
                                        {...restField}
                                        name={[name, 'assetQuantity']}
                                        rules={[
                                            {
                                                required: true,
                                                message: 'Please enter a quantity',
                                            },
                                        ]}
                                    >
                                        <Input placeholder="Enter quantity" />
                                    </Form.Item>
                                    <MinusCircleOutlined onClick={() => remove(name)} />
                                </div>
                            ))}
                            <Form.Item className='flex justify-center w-full'>
                                <Button className='mt-4' type="dashed" onClick={() => add()} block icon={<PlusOutlined />}>
                                    Add asset
                                </Button>
                            </Form.Item>
                        </>
                    )}
                </Form.List>
                <div className='flex justify-center'>
                    <Button
                        className="w-40 mt-6"
                        type="primary"
                        onClick={() => {
                            form.validateFields().then((values) => {
                                handleCreateFormSubmit(values);
                            })
                        }}
                        loading={isCreatingAssetGroup || isUploadImageSubmitting}
                    >
                        Create Group
                    </Button>
                </div>
            </Form>
            {message && openToast("bottom")}
        </>
    )
};


export default CreateGroupForm;