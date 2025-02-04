import { Form, Input, InputNumber, Select } from 'antd';
import { spiritTypes } from '../../helpers/constants';

const { Option } = Select;

export const categoricalProperties = (
  form,
  handleClothingTypeChange,
  clothingType,
  sizeOptions,
  unitOfMeasures
) => {
  switch (form.getFieldValue('subCategory')) {
    case 'Art':
      return (
        <div className="flex justify-between mt-4 ">
          <Form.Item
            label="Artist"
            name="artist"
            className="w-full md:w-72"
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
      );
    case 'Tokens':
      return (
        <div className="flex justify-between gap-3 flex-wrap md:flex-nowrap mt-4">
          <Form.Item
            label="Payment Service Creator"
            name="paymentServiceCreator"
            className=" w-full sm:w-[200px] md:w-30"
            rules={[
              {
                required: false,
                message: 'Please enter the payment service creator',
              },
            ]}
          >
            <Input placeholder="Payment service creator" />
          </Form.Item>
          <Form.Item
            label="Quantity"
            name="quantity"
            className="w-full sm:w-[200px] md:w-30"
            rules={[
              {
                required: true,
                message: 'Please enter a quantity',
              },
              {
                type: 'number',
                min: 1,
                message: 'Quantity must be greater than or equal to 1',
              },
              {
                validator: (_, value) =>
                  value && Number.isInteger(value)
                    ? Promise.resolve()
                    : Promise.reject(new Error('Quantity must be an integer')),
              },
            ]}
          >
            <InputNumber
              style={{
                width: '100%',
                height: '42px',
                display: 'flex',
                alignItems: 'center',
              }}
              min={1}
              placeholder="Enter Quantity"
            />
          </Form.Item>
        </div>
      );
    case 'CarbonOffset':
      return (
        <div className="flex justify-between mt-4 ">
          <Form.Item
            label="Quantity"
            name="quantity"
            className="w-full md:w-72"
            rules={[
              {
                required: true,
                message: 'Please enter a quantity',
              },
              {
                type: 'number',
                min: 1,
                message: 'Quantity must be greater than or equal to 1',
              },
              {
                validator: (_, value) =>
                  value && Number.isInteger(value)
                    ? Promise.resolve()
                    : Promise.reject(new Error('Quantity must be an integer')),
              },
            ]}
          >
            <InputNumber
              style={{
                width: '100%',
                height: '42px',
                display: 'flex',
                alignItems: 'center',
              }}
              min={1}
              placeholder="Enter Quantity"
            />
          </Form.Item>
        </div>
      );
    case 'CarbonDAO':
      return (
        <div className="flex justify-between mt-4 ">
          <Form.Item
            label="Quantity"
            name="quantity"
            className="w-full md:w-72"
            rules={[
              {
                required: true,
                message: 'Please enter a quantity',
              },
              {
                type: 'number',
                min: 1,
                message: 'Quantity must be greater than or equal to 1',
              },
              {
                validator: (_, value) =>
                  value && Number.isInteger(value)
                    ? Promise.resolve()
                    : Promise.reject(new Error('Quantity must be an integer')),
              },
            ]}
          >
            <InputNumber
              style={{
                width: '100%',
                height: '42px',
                display: 'flex',
                alignItems: 'center',
              }}
              min={1}
              placeholder="Enter Quantity"
            />
          </Form.Item>
        </div>
      );
    case 'Clothing':
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <Form.Item
            label="Type"
            name="clothingType"
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
              <Option value="Shirt">Shirt</Option>
              <Option value="Jacket">Jacket</Option>
              <Option value="Pants">Pants</Option>
              <Option value="Shoes">Shoes</Option>
              <Option value="Accessories">Accessories</Option>
            </Select>
          </Form.Item>
          <Form.Item
            label="Brand"
            name="brand"
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
            rules={[
              {
                required: true,
                message: 'Please select a size',
              },
            ]}
          >
            <Select placeholder="Select Size" disabled={!clothingType}>
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
            rules={[
              {
                required: true,
                message: 'Please select a condition',
              },
            ]}
          >
            <Select placeholder="Select Condition">
              <Option value="New">New</Option>
              <Option value="Conditional">Conditional</Option>
              <Option value="Used">Used</Option>
            </Select>
          </Form.Item>
          <Form.Item
            label="SKU"
            name="skuNumber"
            rules={[
              {
                required: true,
                message: 'Please enter a SKU number',
              },
            ]}
          >
            <Input placeholder="Enter SKU Number" />
          </Form.Item>
          <Form.Item
            label="Quantity"
            name="quantity"
            rules={[
              {
                required: true,
                message: 'Please enter a quantity',
              },
              {
                type: 'number',
                min: 1,
                message: 'Quantity must be greater than or equal to 1',
              },
              {
                validator: (_, value) =>
                  value && Number.isInteger(value)
                    ? Promise.resolve()
                    : Promise.reject(new Error('Quantity must be an integer')),
              },
            ]}
          >
            <InputNumber
              style={{
                width: '100%',
                height: '42px',
                display: 'flex',
                alignItems: 'center',
              }}
              min={1}
              placeholder="Enter Quantity"
            />
          </Form.Item>
        </div>
      );
    case 'Collectibles':
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <Form.Item
            label="Condition"
            name="condition"
            rules={[
              {
                required: true,
                message: 'Please select a condition',
              },
            ]}
          >
            <Select placeholder="Select Condition">
              <Option value="New">New</Option>
              <Option value="Conditional">Conditional</Option>
              <Option value="Used">Used</Option>
            </Select>
          </Form.Item>
          <Form.Item
            label="Quantity"
            name="quantity"
            rules={[
              {
                required: true,
                message: 'Please enter a quantity',
              },
              {
                type: 'number',
                min: 1,
                message: 'Quantity must be greater than or equal to 1',
              },
              {
                validator: (_, value) =>
                  value && Number.isInteger(value)
                    ? Promise.resolve()
                    : Promise.reject(new Error('Quantity must be an integer')),
              },
            ]}
          >
            <InputNumber
              style={{
                width: '100%',
                height: '42px',
                display: 'flex',
                alignItems: 'center',
              }}
              min={1}
              placeholder="Enter Quantity"
            />
          </Form.Item>
        </div>
      );
    case 'Metals':
      return (
        <div className="flex flex-wrap gap-4 mt-4 justify-between">
          <Form.Item
            label="Source"
            name="source"
            className=" w-full md:w-72"
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
            className="w-full md:w-72"
            rules={[
              {
                required: true,
                message: 'Please enter a purity',
              },
            ]}
          >
            <Input placeholder="Enter Purity (Ex: 999/1000)" />
          </Form.Item>
          <div className="flex justify-between gap-3 flex-wrap md:flex-nowrap mt-4">
            <Form.Item
              label="Unit of Measurement"
              name="unitOfMeasurement"
              className="w-full md:w-[200px] "
              rules={[
                {
                  required: true,
                  message: 'Please enter a unit of measurement',
                },
              ]}
            >
              <Select
                placeholder="Select Unit of Measurement "
                allowClear
                className="w-full "
                onChange={(value) => {
                  let selectedUOM = unitOfMeasures.find(
                    (u) => u.value === value
                  );
                  form.setFieldValue(
                    'unitOfMeasurement.name',
                    selectedUOM.name
                  );
                  form.setFieldValue('unitOfMeasurement.value', value);
                }}
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
              className="w-full sm:w-[200px] md:w-30"
              rules={[
                {
                  required: true,
                  message: 'Please enter the least sellable unit',
                },
                {
                  type: 'number',
                  min: 1,
                  message:
                    'Least sellable unit must be greater than or equal to 1',
                },
                {
                  validator: (_, value) =>
                    value && Number.isInteger(value)
                      ? Promise.resolve()
                      : Promise.reject(
                          new Error('Least sellable unit must be an integer')
                        ),
                },
              ]}
            >
              <InputNumber
                style={{
                  width: '100%',
                  height: '42px',
                  display: 'flex',
                  alignItems: 'center',
                }}
                min={1}
                placeholder="Enter Least Sellable Units"
              />
            </Form.Item>
            <Form.Item
              label="Quantity"
              name="quantity"
              className="w-full sm:w-[200px] md:w-30"
              rules={[
                {
                  required: true,
                  message: 'Please enter a quantity',
                },
                {
                  type: 'number',
                  min: 1,
                  message: 'Quantity must be greater than or equal to 1',
                },
                {
                  validator: (_, value) =>
                    value && Number.isInteger(value)
                      ? Promise.resolve()
                      : Promise.reject(
                          new Error('Quantity must be an integer')
                        ),
                },
              ]}
            >
              <InputNumber
                style={{
                  width: '100%',
                  height: '42px',
                  display: 'flex',
                  alignItems: 'center',
                }}
                min={1}
                placeholder="Enter Quantity"
              />
            </Form.Item>
          </div>
        </div>
      );
    case 'Membership':
      return (
        <div className="flex flex-wrap sm:flex-nowrap justify-between gap-4 mt-4 ">
          <Form.Item
            label="Expiration (in months)"
            name="expirationPeriodInMonths"
            className="w-full sm:w-72"
            rules={[
              {
                required: true,
                message: 'Please enter an expiration period',
              },
              {
                type: 'number',
                min: 1,
                message: 'Expiration period must be greater than or equal to 1',
              },
              {
                validator: (_, value) =>
                  value && Number.isInteger(value)
                    ? Promise.resolve()
                    : Promise.reject(
                        new Error('Expiration period must be an integer')
                      ),
              },
            ]}
          >
            <InputNumber
              style={{
                width: '100%',
                height: '42px',
                display: 'flex',
                alignItems: 'center',
              }}
              min={1}
              placeholder="Enter Expiration"
            />
          </Form.Item>
          <Form.Item
            label="Quantity"
            name="quantity"
            className="w-full sm:w-72"
            rules={[
              {
                required: true,
                message: 'Please enter a quantity',
              },
              {
                type: 'number',
                min: 1,
                message: 'Quantity must be greater than or equal to 1',
              },
              {
                validator: (_, value) =>
                  value && Number.isInteger(value)
                    ? Promise.resolve()
                    : Promise.reject(new Error('Quantity must be an integer')),
              },
            ]}
          >
            <InputNumber
              style={{
                width: '100%',
                height: '42px',
                display: 'flex',
                alignItems: 'center',
              }}
              min={1}
              placeholder="Enter Quantity"
            />
          </Form.Item>
        </div>
      );
    case 'Spirits':
      return (
        <div className="flex flex-wrap gap-3 mt-4 justify-between">
          <Form.Item
            label="Type"
            name="spiritType"
            className="w-full md:w-[200px]"
            rules={[
              {
                required: true,
                message: 'Please select a spirit type',
              },
            ]}
          >
            <Select
              placeholder="Select Type of spirit"
              onChange={handleClothingTypeChange}
            >
              {spiritTypes.map(({ value, label }) => (
                <Option key={value} value={value}>
                  {label}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            label="Unit of Measurement"
            name="unitOfMeasurement"
            className="w-full md:w-[200px]"
            rules={[
              {
                required: true,
                message: 'Please enter a unit of measurement',
              },
            ]}
          >
            <Select
              placeholder="Select Unit of Measurement "
              allowClear
              className="w-full "
              onChange={(value) => {
                let selectedUOM = unitOfMeasures.find((u) => u.value === value);
                form.setFieldValue('unitOfMeasurement.name', selectedUOM.name);
                form.setFieldValue('unitOfMeasurement.value', value);
              }}
            >
              {unitOfMeasures.map((e, index) => (
                <Option value={e.value} key={index}>
                  {e.name}
                </Option>
              ))}
            </Select>
          </Form.Item>
          <Form.Item
            label="Quantity"
            name="quantity"
            className="w-full sm:w-[200px] md:w-30"
            rules={[
              {
                required: true,
                message: 'Please enter a quantity',
              },
              {
                type: 'number',
                min: 1,
                message: 'Quantity must be greater than or equal to 1',
              },
              {
                validator: (_, value) =>
                  value && Number.isInteger(value)
                    ? Promise.resolve()
                    : Promise.reject(new Error('Quantity must be an integer')),
              },
            ]}
          >
            <InputNumber
              style={{
                width: '100%',
                height: '42px',
                display: 'flex',
                alignItems: 'center',
              }}
              min={1}
              placeholder="Enter Quantity"
            />
          </Form.Item>
        </div>
      );
    default:
      break;
  }
};
