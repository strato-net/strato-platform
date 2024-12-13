import React, { useState, useEffect } from 'react';
import {
  Breadcrumb,
  notification,
  Table,
  Tooltip,
  Typography,
  Pagination,
  Row,
  Col,
} from 'antd';
import image_placeholder from '../../images/resources/image_placeholder.png';
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
import StakeItemActions from '../Inventory/StakeItemActions';
import '../Inventory/index.css';
import PurchasableStakeItems from './PurchasableStakeItems';
import StakeSteps from './StakeSteps';
import StakeInventoryCard from '../Inventory/StakeInventoryCard';
import { useCategoryState, useCategoryDispatch } from '../../contexts/category';
import { actions as categoryActions } from '../../contexts/category/actions';
import { TrophyOutlined, GiftOutlined } from '@ant-design/icons';

const logo = <img src={Images.cata} alt={''} title={''} className="w-5 h-5" />;
const StratsIcon = (
  <img src={Images.strat} alt={''} title={''} className="w-4 h-4" />
);

const { Title } = Typography;

const Stake = ({ user }) => {
  const inventoryDispatch = useInventoryDispatch();
  const categoryDispatch = useCategoryDispatch();
  const {
    reserves,
    inventories,
    isInventoriesLoading,
    inventoriesTotal,
    totalCataReward,
    dailyCataReward,
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
  const navigate = useNavigate();

  const combinedInventories = Object.values(
    inventories.reduce((acc, item) => {
      const root = item.root;
      let entry = acc[root];
      if (!entry) {
        // Initialize a fresh entry
        entry = {
          ...item,
          quantity: item.quantity || 0,
          saleQuantity: item.saleQuantity ? item.quantity : 0,
        };
        entry.address = item.address
          ? [{ address: item.address, sale: item.sale || null }]
          : [];
        entry.escrow = item.escrow && item.escrow.address ? [item.escrow] : [];
        delete entry.root; // Remove the duplicate root field if needed
        acc[root] = entry;
      } else {
        // Merge logic
        for (const key in item) {
          const newVal = item[key];
          const oldVal = entry[key];

          if (key === 'quantity' || key === 'saleQuantity') {
            // Sum quantities
            if (key === 'quantity') {
              entry[key] = (oldVal || 0) + (newVal || 0);
            } else if (key === 'saleQuantity') {
              entry[key] = (oldVal || 0) + (item.quantity || 0);
            }
          } else if (key === 'address') {
            // Append unique address-sale pairs
            const pair = { address: item.address, sale: item.sale || null };
            if (
              !entry.address.some(
                (a) => a.address === pair.address && a.sale === pair.sale
              )
            ) {
              entry.address.push(pair);
            }
          } else if (key === 'escrow') {
            if (newVal && newVal.address) {
              const escrowAddress = newVal.address;
              const existingEscrow = entry.escrow.find(
                (e) => e.address === escrowAddress
              );
              if (!existingEscrow) {
                // Add the new escrow if it doesn't exist
                entry.escrow.push(newVal);
              }
            }
          } else if (oldVal === undefined) {
            // Just set if not present
            entry[key] = newVal;
          } else if (Array.isArray(oldVal)) {
            // If old is array, push newVal if not already included
            if (!oldVal.some((v) => v === newVal)) oldVal.push(newVal);
          } else if (typeof oldVal === 'object' && typeof newVal === 'object') {
            // If both objects differ, convert to array
            if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
              entry[key] = [oldVal, newVal];
            }
          } else if (oldVal !== newVal) {
            // Different primitive -> turn into array if not already
            entry[key] = Array.isArray(oldVal)
              ? [...oldVal, newVal]
              : [oldVal, newVal];
          }
        }
      }
      return acc;
    }, {})
  );
  console.log('combinedInventories', combinedInventories);
  const onPageChange = (page, pageSize) => {
    setLimit(pageSize);
    setOffset((page - 1) * pageSize);
    setPage(page);
  };

  useEffect(() => {
    if (!reserves || reserves.length === 0) {
      inventoryActions.getAllReserve(inventoryDispatch);
      if (user) {
        inventoryActions.getUserCataRewards(inventoryDispatch);
      }
    }
    categoryActions.fetchCategories(categoryDispatch);
  }, [user]);

  useEffect(() => {
    if (user && reserves) {
      inventoryActions.fetchInventory(
        inventoryDispatch,
        2000,
        0,
        '',
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
      render: (_, record) => {
        const borrowedAmount =
          (Array.isArray(record.escrow)
            ? record.escrow.reduce(
                (sum, item) => sum + (item.borrowedAmount || 0),
                0
              )
            : record?.escrow?.borrowedAmount || 0) / 100;
        const callDetailPage = () => {
          navigate(
            `${routes.InventoryDetail.url
              .replace(':id', record.address[0].address)
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
            <div className="flex items-center gap-2">
              Borrowed Amount: {StratsIcon}
              {borrowedAmount.toLocaleString('en-US', {
                maximumFractionDigits: 2,
                minimumFractionDigits: 2,
              })}
            </div>
          </>
        );
      },
    },
    {
      title: 'Owned',
      align: 'center',
      render: (_, record) => {
        return <div>{record.quantity || 0}</div>;
      },
    },
    {
      title: 'Quantity Stakeable',
      align: 'center',
      render: (_, record) => {
        const collateralQuantity = Array.isArray(record.escrow)
          ? record.escrow.reduce(
              (sum, item) => sum + (item.collateralQuantity || 0),
              0
            )
          : record?.escrow?.collateralQuantity || 0;
        const availableQuantity =
          record.quantity - collateralQuantity - (record?.saleQuantity || 0);
        return <div>{availableQuantity > 0 ? availableQuantity : 0}</div>;
      },
    },
    {
      title: 'Quantity Staked',
      align: 'center',
      render: (_, record) => {
        const collateralQuantity = Array.isArray(record.escrow)
          ? record.escrow.reduce(
              (sum, item) => sum + (item.collateralQuantity || 0),
              0
            )
          : record?.escrow?.collateralQuantity || 0;
        return <div>{collateralQuantity}</div>;
      },
    },
    {
      title: 'Actions',
      align: 'center',
      render: (text, record) => (
        <div>
          <StakeItemActions
            inventory={record}
            limit={limit}
            offset={offset}
            debouncedSearchTerm={''}
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
      render: (text, record) => {
        const isStaked = record?.escrow && (record?.escrow.length > 0 || record?.escrow.address);
        const isPublished = !isStaked && record?.price > 0;

        return (
          <div className="pt-[7px] lg:pt-0 items-center gap-[5px]">
            {isStaked ? (
              <div className="flex items-center justify-center gap-2 bg-[#1548C329] p-[6px] rounded-md">
                <div className="w-[7px] h-[7px] rounded-full bg-[#119B2D]"></div>
                <p className="text-[#4D4D4D] text-[13px]">Staked</p>
              </div>
            ) : isPublished ? (
              <div className="flex items-center justify-center gap-2 bg-[#1548C329] p-[6px] rounded-md">
                <div className="w-[7px] h-[7px] rounded-full bg-[#119B2D]"></div>
                <p className="text-[#4D4D4D] text-[13px]">Published</p>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2 bg-[#1548C329] p-[6px] rounded-md">
                <div className="w-[7px] h-[7px] rounded-full bg-[#ff4d4f]"></div>
                <p className="text-[#4D4D4D] text-[13px]">Unstaked</p>
              </div>
            )}
          </div>
        );
      },
    },
  ];

  const expandedRowRender = (parentRecord) => {
    // Filter out the original, uncombined inventories that share the same root
    const filteredInventories = inventories.filter(
      (inv) => inv.root === parentRecord.root
    );

    return (
      <Table
        columns={columns}
        dataSource={filteredInventories}
        loading={isInventoriesLoading}
        rowKey={(record) => record.address}
        pagination={{ pageSize: 5 }}
        className='custom-child-table'
      />
    );
  };

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
        {user && (
          <Row className="w-[95%] mt-10 mx-auto flex justify-start">
            <Col className="w-full sm:w-auto">
              <p className="flex items-center ml-4 font-semibold text-base md:text-lg bg-[#E6F0FF] border border-[#13188A] rounded-md px-3 py-1 text-[#13188A] shadow-sm">
                <TrophyOutlined className="!text-[#13188A] mr-2 text-lg" />
                Total Rewards: &nbsp;{logo}
                <span className="ml-1 font-bold">
                  {totalCataReward.toLocaleString('en-US', {
                    maximumFractionDigits: 4,
                    minimumFractionDigits: 0,
                  })}
                </span>
              </p>
            </Col>
            <Col className="mt-5 sm:mt-0 w-full sm:w-auto">
              <p className="flex items-center ml-4 font-semibold text-base md:text-lg bg-[#FFE6E6] border border-[#D32F2F] rounded-md px-3 py-1 text-[#D32F2F] shadow-sm">
                <GiftOutlined className="!text-[#D32F2F] mr-2 text-lg" />
                Est. Daily Reward: &nbsp;{logo}
                <span className="ml-1 font-bold">
                  {dailyCataReward.toLocaleString('en-US', {
                    maximumFractionDigits: 4,
                    minimumFractionDigits: 0,
                  })}
                </span>
              </p>
            </Col>
          </Row>
        )}
        <div className="pt-6 mx-6 md:mx-5 md:px-10 mb-5">
          <StakeSteps />
          <PurchasableStakeItems />
          {user && (
            <>
              <div className="hidden md:block">
                <Title className="px-3 !text-3xl !text-left mt-10">
                  My Stakeable Items
                </Title>
                <Table
                  columns={columns}
                  dataSource={combinedInventories.slice(offset, offset + limit)}
                  loading={isInventoriesLoading}
                  className="custom-table"
                  pagination={false}
                  expandable={{
                    expandedRowRender,
                    rowExpandable: (record) => true,
                  }}
                  rowKey={(record) => record.root}
                />
                <Pagination
                  current={page}
                  onChange={onPageChange}
                  total={combinedInventories.length}
                  showTotal={(total) => `Total ${total} items`}
                  className="flex justify-center my-5 custom-pagination"
                />
              </div>
              <div className="md:hidden my-4 grid grid-cols-1 gap-6 sm:place-items-center inventoryCard max-w-full">
                <Title className="px-3 !text-3xl !text-left mt-10">
                  My Stakeable Items
                </Title>
                {combinedInventories.map((inventory, index) => (
                  <StakeInventoryCard
                    id={index}
                    limit={limit}
                    offset={offset}
                    inventory={inventory}
                    key={index}
                    debouncedSearchTerm={''}
                    allSubcategories={allSubcategories}
                    user={user}
                    reserves={reserves}
                    stratAddress={stratsAddress}
                    cataAddress={cataAddress}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
      {message && openToast('bottom')}
    </>
  );
};

export default Stake;
