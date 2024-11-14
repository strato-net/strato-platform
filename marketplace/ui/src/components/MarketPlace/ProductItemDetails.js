import { Space, Typography } from 'antd';
import {
  getUnitNameByIndex,
  getSpiritUnitNameByIndex,
} from '../../helpers/constants';

const ProductItemDetails = ({ categoryName, itemData }) => {
  const { Text } = Typography;
  const DescTitle = ({ text }) => {
    return (
      <Text className="text-primaryC text-[13px] whitespace-pre">{text}</Text>
    );
  };

  switch (categoryName) {
    case 'Art':
      return (
        <Space
          direction="vertical"
          className="py-[15px] px-[14px] w-full sm:w-[388px] md:w-[417px] border border-[#E9E9E9] rounded-md"
        >
          <Space className="flex justify-between">
            <DescTitle text="Artist" />
            <Text className="text-[13px] text-[#202020] font-medium">
              {itemData?.artist}
            </Text>
          </Space>
        </Space>
      );
    case 'Clothing':
      return (
        <Space
          direction="vertical"
          className="py-[15px] px-[14px] w-full sm:w-[388px] md:w-[417px] border border-[#E9E9E9] rounded-md"
        >
          <Space className="flex justify-between">
            <DescTitle text="Type" />
            <Text className="text-[13px] text-[#202020] font-medium">
              {itemData?.clothingType}
            </Text>
          </Space>
          <Space className="flex justify-between">
            <DescTitle text="Brand" />
            <Text className="text-[13px] text-[#202020] font-medium">
              {itemData?.brand}
            </Text>
          </Space>
          <Space className="flex justify-between">
            <DescTitle text="Size" />
            <Text className="text-[13px] text-[#202020] font-medium">
              {itemData?.size}
            </Text>
          </Space>
          <Space className="flex justify-between">
            <DescTitle text="Condition" />
            <Text className="text-[13px] text-[#202020] font-medium">
              {itemData?.condition}
            </Text>
          </Space>
          <Space className="flex justify-between">
            <DescTitle text="SKU" />
            <Text className="text-[13px] text-[#202020] font-medium">
              {itemData?.skuNumber}
            </Text>
          </Space>
        </Space>
      );
    case 'Collectibles':
      return (
        <Space
          direction="vertical"
          className="py-[15px] px-[14px] w-full sm:w-[388px] md:w-[417px] border border-[#E9E9E9] rounded-md"
        >
          <Space className="flex justify-between">
            <DescTitle text="Condition" />
            <Text className="text-[13px] text-[#202020] font-medium">
              {itemData?.condition}
            </Text>
          </Space>
        </Space>
      );
    case 'Metals':
      return (
        <Space
          direction="vertical"
          className="py-[15px] px-[14px] w-full sm:w-[388px] md:w-[417px] border border-[#E9E9E9] rounded-md"
        >
          <Space className="flex justify-between">
            <DescTitle text="Source" />
            <Text className="text-[13px] text-[#202020] font-medium">
              {itemData?.source}
            </Text>
          </Space>
          <Space className="flex justify-between">
            <DescTitle text="Purity" />
            <Text className="text-[13px] text-[#202020] font-medium">
              {itemData?.purity}
            </Text>
          </Space>
          <Space className="flex justify-between">
            <DescTitle text="Unit of Measurement" />
            <Text className="text-[13px] text-[#202020] font-medium">
              {getUnitNameByIndex(itemData?.unitOfMeasurement)}
            </Text>
          </Space>
          <Space className="flex justify-between">
            <DescTitle text="Least Sellable Unit" />
            <Text className="text-[13px] text-[#202020] font-medium">
              {itemData?.leastSellableUnits}
            </Text>
          </Space>
        </Space>
      );
    case 'Membership':
      return (
        <Space
          direction="vertical"
          className="py-[15px] px-[14px] w-full sm:w-[388px] md:w-[417px] border border-[#E9E9E9] rounded-md"
        >
          <Space className="flex justify-between">
            <DescTitle text="Expiration (in months)" />
            <Text className="text-[13px] text-[#202020] font-medium">
              {itemData?.expirationPeriodInMonths}
            </Text>
          </Space>
        </Space>
      );
    case 'Spirits':
      return (
        <Space
          direction="vertical"
          className="py-[15px] px-[14px] w-full sm:w-[388px] md:w-[417px] border border-[#E9E9E9] rounded-md"
        >
          <Space className="flex justify-between">
            <DescTitle text="Type" />
            <Text className="text-[13px] text-[#202020] font-medium">
              {itemData?.spiritType}
            </Text>
          </Space>
          <Space className="flex justify-between">
            <DescTitle text="Unit of Measurement" />
            <Text className="text-[13px] text-[#202020] font-medium">
              {getSpiritUnitNameByIndex(itemData?.unitOfMeasurement)}
            </Text>
          </Space>
        </Space>
      );
    default:
      break;
  }
};

export default ProductItemDetails;
