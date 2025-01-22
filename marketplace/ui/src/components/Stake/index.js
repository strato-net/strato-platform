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
import { stakeColumns, aggregateStakeColumns } from './columns';

const logo = <img src={Images.cata} alt={''} title={''} className="w-5 h-5" />;
const USDSTIcon = (
  <img src={Images.USDST} alt={''} title={''} className="w-4 h-4" />
);

function combineInventories(items, assetsWithEighteenDecimalPlaces) {
  // Step 1: Group items by `root`
  const grouped = items.reduce((acc, item) => {
    const { root } = item;
    if (!acc[root]) acc[root] = [];
    acc[root].push(item);
    return acc;
  }, {});

  // Step 2: Process each group to create the combined structure
  const combined = Object.values(grouped).map((group) => {
    // Extract the first item to retrieve common fields
    const [firstItem] = group;
    const {
      root,
      name,
      'BlockApps-Mercata-Asset-fileNames': assetFileNames,
      'BlockApps-Mercata-Asset-files': assetFiles,
      'BlockApps-Mercata-Asset-images': assetImages,
    } = firstItem;

    const requiresDivision = assetsWithEighteenDecimalPlaces.includes(root);

    // Step 3: Sum `quantity` and `saleQuantity` across the group
    const totalQuantity = group.reduce((sum, item) => {
      const quantity = item.quantity || 0;
      return sum + (requiresDivision ? quantity / 1e18 : quantity);
    }, 0);
    const totalSaleQuantity = group.reduce((sum, item) => {
      const saleQuantity = item.saleQuantity ? item.quantity || 0 : 0;
      return sum + (requiresDivision ? saleQuantity / 1e18 : saleQuantity);
    }, 0);

    // Step 4: Aggregate varying fields into `inventories`
    const inventoriesArr = group.map((item) => {
      const inventory = { ...item };
      // Remove common top-level fields
      delete inventory['BlockApps-Mercata-Asset-fileNames'];
      delete inventory['BlockApps-Mercata-Asset-files'];
      delete inventory['BlockApps-Mercata-Asset-images'];
      return inventory;
    });

    // Construct the combined object
    return {
      root,
      name,
      'BlockApps-Mercata-Asset-fileNames': assetFileNames,
      'BlockApps-Mercata-Asset-files': assetFiles,
      'BlockApps-Mercata-Asset-images': assetImages,
      totalQuantity,
      totalSaleQuantity,
      inventories: inventoriesArr,
    };
  });

  return combined;
}
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
  const { USDSTAddress, assetsWithEighteenDecimalPlaces } = useMarketplaceState();
  const linkUrl = window.location.href;
  const [api, contextHolder] = notification.useNotification();
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(1);
  const navigate = useNavigate();

  const combinedInventories = combineInventories(inventories, assetsWithEighteenDecimalPlaces);
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

  const expandedRowRender = (parentRecord) => {
    const filteredInventories = inventories.filter(
      (inv) => inv.root === parentRecord.root
    );
  
    // Extract unique escrows from filtered inventories
    const uniqueEscrows = [
      ...new Set(
        filteredInventories
          .map((inv) => inv.escrow?.address)
          .filter(Boolean) // Remove null/undefined addresses
      ),
    ];
  
    // Populate missing escrows
    const populatedInventories = filteredInventories.map((inv) => {
      if (!inv.escrow || !inv.escrow.address) {
        // Assign a copy of the unique escrows
        return {
          ...inv,
          escrow: { ...inv.escrow, address: uniqueEscrows[0] || null }, // Assign the first available escrow or null
        };
      }
      return inv;
    });
    return (
      <Table
        columns={stakeColumns(
          user,
          limit,
          offset,
          reserves,
          USDSTAddress,
          assetsWithEighteenDecimalPlaces,
          navigate
        )}
        dataSource={populatedInventories}
        loading={isInventoriesLoading}
        rowKey={(record) => record.address}
        pagination={false}
        className="custom-child-table"
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
                  columns={aggregateStakeColumns(
                    user,
                    limit,
                    offset,
                    reserves,
                    USDSTAddress,
                    assetsWithEighteenDecimalPlaces
                  )}
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
                    assetsWithEighteenDecimalPlaces={assetsWithEighteenDecimalPlaces}
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
