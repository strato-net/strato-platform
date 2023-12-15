import {
    Form,
    Input,
    InputNumber,
    Select
} from "antd";


const CategoryFields = ({ category, handleClothingTypeChange, clothingType, sizeOptions, unitOfMeasures }) => {
    const { Option } = Select;

    return (
        <div>
            {category === "Art" &&
                <div className="flex justify-between mt-4 ">
                    <Form.Item
                        label="Artist"
                        name="artist"
                        className="w-72"
                        rules={[
                            {
                                required: true,
                                message: 'Please enter an artist',
                            },
                        ]}
                    >
                        <Input placeholder="Enter Artist" />
                    </Form.Item>
                </div>
            }
            {category === "CarbonOffset" &&
                <div className="flex justify-between mt-4 ">
                    <Form.Item
                        label="Quantity"
                        name="quantity"
                        className="w-72"
                        rules={[
                            {
                                required: true,
                                message: 'Please enter a quantity',
                            },
                        ]}
                    >
                        <InputNumber className="w-72 custom-input-number" placeholder="Enter Quantity" min={1} />
                    </Form.Item>
                </div>
            }
            {category === "Clothing" &&
                <div className="flex flex-wrap gap-4 mt-4">
                    <Form.Item
                        label="Type"
                        name="clothingType"
                        className="mr-8 w-72"
                        rules={[
                            {
                                required: true,
                                message: 'Please select a clothing type',
                            },
                        ]}
                    >
                        <Select
                            placeholder="Select Type of Clothing"
                            onChange={handleClothingTypeChange}
                        >
                            <Option value="shirt">Shirt</Option>
                            <Option value="jacket">Jacket</Option>
                            <Option value="pants">Pants</Option>
                            <Option value="shoes">Shoes</Option>
                            <Option value="accessories">Accessories</Option>
                        </Select>
                    </Form.Item>
                    <Form.Item
                        label="Brand"
                        name="brand"
                        className="w-72"
                        rules={[
                            {
                                required: true,
                                message: 'Please enter a brand',
                            },
                        ]}
                    >
                        <Input placeholder="Enter Brand" />
                    </Form.Item>
                    <Form.Item
                        label="Size"
                        name="size"
                        className="mr-8 w-72"
                        rules={[
                            {
                                required: true,
                                message: 'Please select a size',
                            },
                        ]}
                    >
                        <Select
                            placeholder="Select Size"
                            disabled={!clothingType}
                        >
                            {sizeOptions.map((size, index) => (
                                <Option key={index} value={size}>
                                    {size}
                                </Option>
                            ))}
                        </Select>
                    </Form.Item>
                    <Form.Item
                        label="Condition"
                        name="condition"
                        className="w-72"
                        rules={[
                            {
                                required: true,
                                message: 'Please select a condition',
                            },
                        ]}
                    >
                        <Select placeholder="Select Condition" >
                            <Option value="new">New</Option>
                            <Option value="conditional">Conditional</Option>
                            <Option value="used">Used</Option>
                        </Select>
                    </Form.Item>
                    <Form.Item
                        label="SKU"
                        name="skuNumber"
                        className="mr-8 w-72"
                        rules={[
                            {
                                required: true,
                                message: 'Please enter a SKU Number',
                            },
                        ]}
                    >
                        <Input placeholder="Enter SKU Number" />
                    </Form.Item>
                    <Form.Item
                        label="Quantity"
                        name="quantity"
                        className="w-72"
                        rules={[
                            {
                                required: true,
                                message: 'Please enter a quantity',
                            },
                        ]}
                    >
                        <InputNumber className="w-72 custom-input-number" placeholder="Enter Quantity" min={1} />
                    </Form.Item>
                </div>
            }
            {category === "Collectibles" &&
                <div className="flex flex-wrap gap-4 mt-4">
                    <Form.Item
                        label="Condition"
                        name="condition"
                        className="mr-8 w-72"
                        rules={[
                            {
                                required: true,
                                message: 'Please select a condition',
                            },
                        ]}
                    >
                        <Select placeholder="Select Condition" >
                            <Option value="new">New</Option>
                            <Option value="conditional">Conditional</Option>
                            <Option value="used">Used</Option>
                        </Select>
                    </Form.Item>
                    <Form.Item
                        label="Quantity"
                        name="quantity"
                        className="w-72"
                        rules={[
                            {
                                required: true,
                                message: 'Please enter a quantity',
                            },
                        ]}
                    >
                        <InputNumber className="w-72 custom-input-number" placeholder="Enter Quantity" min={1} />
                    </Form.Item>
                </div>
            }
            {category === "Metals" &&
                <div className="flex flex-wrap gap-4 mt-4">
                    <Form.Item
                        label="Source"
                        name="source"
                        className="mr-8 w-72"
                        rules={[
                            {
                                required: true,
                                message: 'Please enter a source',
                            },
                        ]}
                    >
                        <Input placeholder="Enter Material Source" />
                    </Form.Item>
                    <Form.Item
                        label="Purity"
                        name="purity"
                        className="w-72"
                        rules={[
                            {
                                required: true,
                                message: 'Please enter a purity',
                            },
                        ]}
                    >
                        <Input placeholder="Enter Purity" />
                    </Form.Item>
                    <Form.Item
                        label="Unit of Measurement"
                        name="unitOfMeasurement"
                        className="mr-8 w-72"
                        rules={[
                            {
                                required: true,
                                message: 'Please select a unit of measurement',
                            },
                        ]}
                    >
                        <Select
                            placeholder="Select Unit of Measurement"
                            allowClear
                        >
                            {unitOfMeasures.map((e, index) => (
                                <Option value={e.value} key={index}>
                                    {e.name}
                                </Option>
                            ))}
                        </Select>
                    </Form.Item>
                    <Form.Item
                        label="Least Sellable Unit(s)"
                        name="leastSellableUnits"
                        className="w-72"
                        rules={[
                            {
                                required: true,
                                message: 'Please enter the least sellable unit',
                            },
                        ]}
                    >
                        <InputNumber className="w-72 custom-input-number" placeholder="Enter Least Sellable Units" min={1} />
                    </Form.Item>
                    <Form.Item
                        label="Quantity"
                        name="quantity"
                        className="mr-8 w-72"
                        rules={[
                            {
                                required: true,
                                message: 'Please enter a quantity',
                            },
                        ]}
                    >
                        <InputNumber className="w-72 custom-input-number" placeholder="Enter Quantity" min={1} />
                    </Form.Item>
                </div>
            }
            {category === "Membership" &&
                <div className="flex justify-between mt-4 ">
                    <Form.Item
                        label="Expiration (in months)"
                        name="expirationPeriodInMonths"
                        className="w-72"
                        rules={[
                            {
                                required: true,
                                message: 'Please enter an expiration (in months)',
                            },
                        ]}
                    >
                        <InputNumber className="w-72 custom-input-number" placeholder="Enter Expiration (in months)" min={1} />
                    </Form.Item>
                    <Form.Item
                        label="Quantity"
                        name="quantity"
                        className="w-72"
                        rules={[
                            {
                                required: true,
                                message: 'Please enter a quantity',
                            },
                        ]}
                    >
                        <InputNumber className="w-72 custom-input-number" placeholder="Enter Quantity" min={1} />
                    </Form.Item>
                </div>
            }
            {category === "CarbonDAO" &&
                <div className="flex justify-between mt-4 ">
                    <Form.Item
                        label="Quantity"
                        name="quantity"
                        className="w-72"
                        rules={[
                            {
                                required: true,
                                message: 'Please enter a quantity',
                            },
                        ]}
                    >
                        <InputNumber className="w-72 custom-input-number" placeholder="Enter Quantity" min={1} />
                    </Form.Item>
                </div>
            }
        </div>
    );
};


export default CategoryFields;