import React, { useState, useEffect } from 'react';
import {
  Breadcrumb,
  notification,
  Select,
  Table,
  Tooltip,
  Typography,
  Pagination,
  Row,
  Col,
} from 'antd';
import image_placeholder from '../../images/resources/image_placeholder.png';
import useDebounce from '../UseDebounce';
import { actions as inventoryActions } from '../../contexts/inventory/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import { Images } from '../../images';
import { useMarketplaceState } from '../../contexts/marketplace';
import ClickableCell from '../ClickableCell';
import routes from '../../helpers/routes';
import { useNavigate } from 'react-router-dom';
import HelmetComponent from '../Helmet/HelmetComponent';
import { SEO } from '../../helpers/seoConstant';
import { STRATS_CONVERSION, ASSET_STATUS } from '../../helpers/constants';
import ItemActions from '../Inventory/ItemActions';
import '../Inventory/index.css';
import PurchasableStakeItems from './PurchasableStakeItems';
import StakeSteps from './StakeSteps';
import InventoryCard from '../Inventory/InventoryCard';
import { useCategoryState, useCategoryDispatch } from '../../contexts/category';
import { actions as categoryActions } from '../../contexts/category/actions';
import { DollarOutlined, GiftOutlined } from '@ant-design/icons';

const { Title } = Typography;
const StratsIcon = <img src={Images.strat} alt="STRATS" className="w-4 h-4" />;

const Stake = ({ user }) => {
  const inventoryDispatch = useInventoryDispatch();
  const categoryDispatch = useCategoryDispatch();
  const {
    reserves,
    inventories,
    isInventoriesLoading,
    inventoriesTotal,
    message,
    success,
  } = useInventoryState();
  const { categorys } = useCategoryState();
  const { stratsAddress, cataAddress } = useMarketplaceState();
  const linkUrl = window.location.href;
  const [api, contextHolder] = notification.useNotification();
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(1);
  const [queryValue, setQueryValue] = useState('');
  const debouncedSearchTerm = useDebounce(queryValue, 1000);
  const navigate = useNavigate();

  const onPageChange = (page, pageSize) => {
    setLimit(pageSize);
    setOffset((page - 1) * pageSize);
    setPage(page);
  };

  useEffect(() => {
    if (!reserves || reserves.length === 0) {
      inventoryActions.getAllReserve(inventoryDispatch);
    }
    categoryActions.fetchCategories(categoryDispatch);
  }, []);

  useEffect(() => {
    if (reserves) {
      inventoryActions.fetchInventory(
        inventoryDispatch,
        limit,
        offset,
        debouncedSearchTerm,
        undefined,
        reserves.map((reserve) => reserve.assetRootAddress)
      );
    }
  }, [reserves]);

  const openToast = (placement) => {
    if (success) {
      api.success({
        message: message,
        onClose: inventoryActions.resetMessage(inventoryDispatch),
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: message,
        onClose: inventoryActions.resetMessage(inventoryDispatch),
        placement,
        key: 2,
      });
    }
  };

  const getAllSubcategories = (categories) => {
    let subcategories = [];
    categories.forEach((category) => {
      if (category.subCategories && category.subCategories.length > 0) {
        subcategories = subcategories.concat(category.subCategories);
      }
    });
    return subcategories;
  };

  const allSubcategories = getAllSubcategories(categorys);

  const columns = [
    {
      title: 'Item',
      render: (text, record) => {
        const isStakeable =
          record.originAddress &&
          reserves &&
          reserves.length > 0 &&
          reserves.some(
            (reserve) => record.originAddress === reserve.assetRootAddress
          );
        const callDetailPage = () => {
          navigate(
            `${routes.InventoryDetail.url
              .replace(':id', record.address)
              .replace(':name', encodeURIComponent(record.name))}`,
            {
              state: { isCalledFromInventory: true },
            }
          );
        };
        return (
          <>
            <div className="flex items-center">
              <div className="mr-2 w-[74px] h-[52px] flex items-center justify-center">
                <img
                  src={
                    record['BlockApps-Mercata-Asset-images'] &&
                    record['BlockApps-Mercata-Asset-images'].length > 0
                      ? record['BlockApps-Mercata-Asset-images'][0].value
                      : image_placeholder
                  }
                  alt={'Asset image...'}
                  className="rounded-md w-full h-full object-contain"
                />
              </div>
              <div>
                <span
                  className="text-xs sm:text-sm text-[#13188A] hover:underline cursor-pointer"
                  onClick={callDetailPage}
                >
                  <Tooltip title={record.name}>
                    <span className="w-48 whitespace-nowrap overflow-hidden text-ellipsis block">
                      {record.name}
                    </span>
                  </Tooltip>
                </span>
              </div>
            </div>
            {isStakeable && (
              <>
                <div> Borrowed Amount: $33,516 </div>
              </>
            )}
          </>
        );
      },
    },
    {
      title: 'Price',
      align: 'center',
      render: (_, record) => {
        const isDecimal =
          record.data.quantityIsDecimal &&
          record.data.quantityIsDecimal === 'True';
        const price = record.price
          ? isDecimal
            ? parseFloat(record.price * 100).toFixed(2)
            : record.price
          : 'N/A';
        return (
          <div>
            {price !== 'N/A' ? (
              <>
                <span>${price}</span>{' '}
                <p className="flex text-xs items-center gap-1">
                  {' '}
                  &nbsp;({(price * STRATS_CONVERSION).toFixed(0)} {StratsIcon}){' '}
                </p>
              </>
            ) : (
              'N/A'
            )}
          </div>
        );
      },
    },
    {
      title: 'Owned',
      align: 'center',
      render: (_, record) => {
        const isStrats = record.originAddress === stratsAddress;
        const isCata = record.originAddress === cataAddress;
        const quantity = isStrats
          ? parseFloat((record.quantity / 100).toFixed(2))
          : isCata
          ? parseFloat((record.quantity / Math.pow(10, 18)).toFixed(18))
          : record.quantity;
        return <div>{quantity || 0}</div>;
      },
    },
    {
      title: 'Quantity Staked',
      align: 'center',
      render: (_, record) => {
        const isStrats =
          record.data.quantityIsDecimal &&
          record.data.quantityIsDecimal === 'True';
        const saleQuantity = isStrats
          ? parseFloat((record.saleQuantity / 100).toFixed(2))
          : record.saleQuantity;
        return <div>{saleQuantity || 0}</div>;
      },
    },
    {
      title: 'Actions',
      align: 'center',
      render: (text, record) => (
        <div>
          <ItemActions
            inventory={record}
            limit={limit}
            offset={offset}
            debouncedSearchTerm={debouncedSearchTerm}
            user={user}
            reserves={reserves}
            stratAddress={stratsAddress}
            cataAddress={cataAddress}
          />
        </div>
      ),
    },
    {
      title: 'Status',
      align: 'center',
      render: (text, record) => (
        <div className="pt-[7px] lg:pt-0 items-center gap-[5px]">
          {record.price || record?.maxStratsLoanAmount ? (
            <div className="flex items-center justify-center gap-2 bg-[#1548C329] p-[6px] rounded-md">
              <div className="w-[7px] h-[7px] rounded-full bg-[#119B2D]"></div>
              <p className="text-[#4D4D4D] text-[13px]">
                {' '}
                {record?.maxStratsLoanAmount ? 'Staked' : 'Published'}{' '}
              </p>
            </div>
          ) : record.status == ASSET_STATUS.PENDING_REDEMPTION ? (
            <div className="flex items-center justify-center gap-2 bg-[#FFA50029] p-[6px] rounded-md">
              <div className="w-[8px] h-[7px] rounded-full bg-[#FFA500]"></div>
              <p className="text-[#4D4D4D] text-[13px]">Pending Redemption</p>
            </div>
          ) : record.status == ASSET_STATUS.RETIRED ? (
            <div className="flex items-center justify-center gap-2 bg-[#c3152129] p-[6px] rounded-md">
              <div className="w-[7px] h-[7px] rounded-full bg-[#ff4d4f]"></div>
              <p className="text-[#4D4D4D] text-[13px]">Retired</p>
            </div>
          ) : (record.data.isMint &&
              record.data.isMint === 'False' &&
              record.quantity === 0) ||
            (!record.data.isMint && record.quantity === 0) ? (
            <div className="flex items-center justify-center gap-2 bg-[#FFA50029] p-[6px] rounded-md">
              <div className="w-[7px] h-[7px] rounded-full bg-[#FFA500]"></div>
              <p className="text-[#4D4D4D] text-[13px]">Sold Out</p>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 bg-[#1548C329] p-[6px] rounded-md">
              <div className="w-[7px] h-[7px] rounded-full bg-[#ff4d4f]"></div>
              <p className="text-[#4D4D4D] text-[13px]">Unpublished</p>
            </div>
          )}
        </div>
      ),
    },
  ];

  return (
    <>
      <HelmetComponent
        title={`${SEO.TITLE_META} `}
        description={SEO.DESCRIPTION_META}
        link={linkUrl}
      />
      {contextHolder}
      <Breadcrumb className="mx-5 md:mx-14 mt-2 lg:mt-4">
        <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
          <ClickableCell href={routes.Marketplace.url}>
            <p className="text-sm text-[#13188A] font-semibold">Home</p>
          </ClickableCell>
        </Breadcrumb.Item>
        <Breadcrumb.Item>
          <p className="text-sm text-[#202020] font-medium">Stake</p>
        </Breadcrumb.Item>
      </Breadcrumb>
      <div>
      <Row className='w-[95%] mt-10 mx-auto flex justify-start'>
        <Col className='w-full sm:w-auto'>
        <p className="flex items-center ml-4 font-semibold text-base md:text-lg bg-[#E6F0FF] border border-[#13188A] rounded-md px-3 py-1 text-[#13188A] shadow-sm">
          <DollarOutlined className="!text-[#13188A] mr-2 text-lg" />
          Total Rewards (CATA):
          <span className="ml-2 font-bold">334,133</span>
        </p>
        </Col>
        <Col className='mt-5 sm:mt-0 w-full sm:w-auto'>
        <p className="flex items-center ml-4 font-semibold text-base md:text-lg bg-[#FFE6E6] border border-[#D32F2F] rounded-md px-3 py-1 text-[#D32F2F] shadow-sm">
          <GiftOutlined className="!text-[#D32F2F] mr-2 text-lg" />
          Est. Daily Reward (CATA):
          <span className="ml-2 font-bold">1,321</span>
        </p>
        </Col>
      </Row>
        <div className="pt-6 mx-6 md:mx-5 md:px-10 mb-5">
          <StakeSteps />
          <PurchasableStakeItems />
          <div className="hidden md:block">
            <Title className="px-3 !text-3xl !text-left mt-10">
              My Stakeable Items
            </Title>
            <Table
              columns={columns}
              dataSource={inventories}
              loading={isInventoriesLoading}
              className="custom-table"
              pagination={false}
            />
            <Pagination
              current={page}
              onChange={onPageChange}
              total={inventoriesTotal}
              showTotal={(total) => `Total ${total} items`}
              className="flex justify-center my-5 custom-pagination"
            />
          </div>
          <div className="md:hidden my-4 grid grid-cols-1 gap-6 sm:place-items-center inventoryCard max-w-full">
            <Title className="px-3 !text-3xl !text-left mt-10">
              My Stakeable Items
            </Title>
            {inventories.map((inventory, index) => (
              <InventoryCard
                id={index}
                limit={limit}
                offset={offset}
                inventory={inventory}
                key={index}
                debouncedSearchTerm={debouncedSearchTerm}
                allSubcategories={allSubcategories}
                user={user}
                reserves={reserves}
                stratAddress={stratsAddress}
                cataAddress={cataAddress}
              />
            ))}
          </div>
        </div>
      </div>
      {message && openToast('bottom')}
    </>
  );
};

export default Stake;
