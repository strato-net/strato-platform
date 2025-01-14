import React, { useState, useEffect } from 'react';
import {
  Breadcrumb,
  Button,
  Pagination,
  notification,
  Select,
  Spin,
  Space,
  Input,
  Table,
  Checkbox,
  Tooltip,
} from 'antd';
import {
  CheckCircleOutlined,
  TrophyOutlined,
  GiftOutlined,
} from '@ant-design/icons';
import BigNumber from 'bignumber.js';
import image_placeholder from '../../images/resources/image_placeholder.png';
import CreateInventoryModal from './CreateInventoryModal';
import { actions as categoryActions } from '../../contexts/category/actions';
import { useCategoryDispatch, useCategoryState } from '../../contexts/category';
import useDebounce from '../UseDebounce';
import { actions } from '../../contexts/inventory/actions';
import {
  useInventoryDispatch,
  useInventoryState,
} from '../../contexts/inventory';
import {
  usePaymentServiceDispatch,
  usePaymentServiceState,
} from '../../contexts/payment';
import { actions as paymentServiceActions } from '../../contexts/payment/actions';
import { Images } from '../../images';
import { useItemDispatch, useItemState } from '../../contexts/item';
import { actions as itemActions } from '../../contexts/item/actions';
import { actions as redemptionActions } from '../../contexts/redemption/actions';
import { actions as issuerStatusActions } from '../../contexts/issuerStatus/actions';
import { actions as marketplaceActions } from '../../contexts/marketplace/actions';
import { actions as ethActions } from '../../contexts/eth/actions';
import {
  useMarketplaceDispatch,
  useMarketplaceState,
} from '../../contexts/marketplace';
import { useEthDispatch, useEthState } from '../../contexts/eth';
import {
  useRedemptionDispatch,
  useRedemptionState,
} from '../../contexts/redemption';
import {
  useIssuerStatusState,
  useIssuerStatusDispatch,
} from '../../contexts/issuerStatus';
import ClickableCell from '../ClickableCell';
import routes from '../../helpers/routes';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuthenticateState } from '../../contexts/authentication';
import HelmetComponent from '../Helmet/HelmetComponent';
import { SEO } from '../../helpers/seoConstant';
import RequestBeAuthorizedIssuerModal from './RequestBeAuthorizedIssuerModal';
import { ISSUER_STATUS, ASSET_STATUS } from '../../helpers/constants';
import ItemActions from './ItemActions';
import InventoryCard from './InventoryCard';
import './index.css';

const { Option } = Select;
const USDSTIcon = <img src={Images.USDST} alt="USDST" className="w-4 h-4" />;
const logo = <img src={Images.cata} alt={''} title={''} className="w-5 h-5" />;

const Inventory = ({ user }) => {
  const [open, setOpen] = useState(false);
  const [reqModOpen, setReqModOpen] = useState(false);
  const [queryValue, setQueryValue] = useState('');
  const debouncedSearchTerm = useDebounce(queryValue, 1000);
  const [limit, setLimit] = useState(10);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState(1);
  const [showPublished, setShowPublished] = useState(false);
  const dispatch = useInventoryDispatch();
  const ethDispatch = useEthDispatch();
  const [api, contextHolder] = notification.useNotification();
  const [category, setCategory] = useState(undefined);
  const linkUrl = window.location.href;
  const metaImg = SEO.IMAGE_META;
  const navigate = useNavigate();
  const naviroute = routes.InventoryDetail.url;
  const ethNaviroute = routes.EthstProductDetail.url;
  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
  const { USDSTAddress, assetsWithEighteenDecimalPlaces } =
    useMarketplaceState();
  const formatter = new Intl.NumberFormat('en-US');
  const formattedNum = (num) => formatter.format(num);

  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const searchQueryValue = queryParams.get('st') || '';
  const [showStakeable, setShowStakeable] = useState(searchQueryValue);

  const categoryDispatch = useCategoryDispatch();
  const { categorys } = useCategoryState();
  const {
    inventories,
    isInventoriesLoading,
    message,
    success,
    inventoriesTotal,
    userInventories,
    userInventoriesTotal,
    isUserInventoriesLoading,
    supportedTokens,
    isFetchingTokens,
    isReservesLoading,
    reserves,
    totalCataReward,
    dailyCataReward,
  } = useInventoryState();

  const { ethstAddress } = useEthState();

  const {
    paymentServices,
    arePaymentServicesLoading,
    notOnboarded,
    areNotOnboardedLoading,
  } = usePaymentServiceState();
  const paymentServiceDispatch = usePaymentServiceDispatch();
  const [sortedPaymentServices, setSortedPaymentServices] = useState([]);

  const isNotOnboarded = (service) =>
    notOnboarded.some((n) => n.serviceName === service.serviceName);

  useEffect(() => {
    // Create a set of not onboarded service names for quick lookup
    const notOnboardedNames = new Set(notOnboarded.map((n) => n.serviceName));

    // Sort paymentServices array so that not onboarded services come first
    const sortedServices = [...paymentServices]
      .sort((a, b) => {
        return isNotOnboarded(a) - isNotOnboarded(b);
      })
      .map((service) => ({
        ...service,
        isNotOnboarded: notOnboardedNames.has(service.serviceName),
      }));
    setSortedPaymentServices(sortedServices);
  }, [paymentServices, notOnboarded]);

  useEffect(() => {
    if (user && user.commonName) {
      paymentServiceActions.getPaymentServices(paymentServiceDispatch, true);
      paymentServiceActions.getNotOnboarded(
        paymentServiceDispatch,
        user.commonName,
        10,
        0
      );

      setIssuerStatus(user?.issuerStatus);
    }
  }, [paymentServiceDispatch, user]);

  const itemDispatch = useItemDispatch();
  const { message: itemMsg, success: itemSuccess } = useItemState();
  const redemptionDispatch = useRedemptionDispatch();
  const { message: redemptionMsg, success: redemptionSuccess } =
    useRedemptionState();
  const [issuerStatus, setIssuerStatus] = useState(user?.issuerStatus);

  const issuerStatusDispatch = useIssuerStatusDispatch();
  const { message: issuerStatusMsg, success: issuerStatusSuccess } =
    useIssuerStatusState();

  useEffect(() => {
    actions.getAllReserve(dispatch);
    actions.getUserCataRewards(dispatch);
    actions.fetchSupportedTokens(dispatch);
    categoryActions.fetchCategories(categoryDispatch);
    ethActions.fetchETHSTAddress(ethDispatch);
  }, []);

  useEffect(() => {
    if (reserves) {
      if (showPublished) {
        actions.fetchInventoryForUser(
          dispatch,
          limit,
          offset,
          debouncedSearchTerm,
          category && category !== 'All' ? category : undefined,
          queryParams.get('st') === 'true'
            ? reserves.map((reserve) => reserve.assetRootAddress)
            : ''
        );
      } else {
        actions.fetchInventory(
          dispatch,
          limit,
          offset,
          debouncedSearchTerm,
          category && category !== 'All' ? category : undefined,
          queryParams.get('st') === 'true'
            ? reserves.map((reserve) => reserve.assetRootAddress)
            : ''
        );
      }
      setShowStakeable(queryParams.get('st'));
    }
  }, [
    dispatch,
    limit,
    offset,
    debouncedSearchTerm,
    category,
    showPublished,
    showStakeable,
    reserves,
    location.search,
  ]);

  const showModal = () => {
    setOpen(true);
  };

  const handleCancel = () => {
    setOpen(false);
  };

  const handleOnboard = async (service) => {
    if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
      window.location.href = loginUrl;
    } else {
      const serviceURL = service.serviceURL || service.data.serviceURL;
      const onboardingRoute =
        service.onboardingRoute || service.data.onboardingRoute;
      if (serviceURL && onboardingRoute) {
        const url = `${serviceURL}${onboardingRoute}?username=${user.commonName}&redirectUrl=${window.location.protocol}//${window.location.host}${window.location.pathname}`;
        window.location.replace(url);
      }
    }
  };

  const handleChange = (value) => {
    const service = notOnboarded.find(
      (service) => service.serviceName === value
    );
    handleOnboard(service);
  };

  const showReqModModal = () => {
    setReqModOpen(true);
  };

  const handleReqModCancel = () => {
    setReqModOpen(false);
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

  const queryHandleEnter = (e) => {
    const value = e.target.value;
    setQueryValue(value);
    setOffset(0);
    setPage(1);
  };

  const queryHandleChange = (e) => {
    const value = e.target.value;
    if (value.length === 0 && queryValue.length > 0) {
      setQueryValue(value);
      setOffset(0);
      setPage(1);
    }
  };

  const handleTabSelect = (key) => {
    setCategory(key);
    setOffset(0);
    setPage(1);
    return;
  };

  const onPageChange = (page, pageSize) => {
    setLimit(pageSize);
    setOffset((page - 1) * pageSize);
    setPage(page);
  };

  const handlePublishedCheckboxChange = (e) => {
    setShowPublished(e.target.checked);
  };

  const handleStakeableCheckboxChange = (e) => {
    const baseUrl = new URL(`/mywallet`, window.location.origin);
    const value = e.target.checked;
    baseUrl.searchParams.set('st', value);
    const url = baseUrl.pathname + baseUrl.search;
    navigate(url, { replace: true });
    setShowStakeable(value ? 'true' : 'false');
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

  const itemToast = (placement) => {
    if (itemSuccess) {
      api.success({
        message: itemMsg,
        onClose: itemActions.resetMessage(itemDispatch),
        placement,
        key: 3,
      });
    } else {
      api.error({
        message: itemMsg,
        onClose: itemActions.resetMessage(itemDispatch),
        placement,
        key: 4,
      });
    }
  };

  const redemptionToast = (placement) => {
    if (redemptionSuccess) {
      api.success({
        message: redemptionMsg,
        onClose: redemptionActions.resetMessage(redemptionDispatch),
        placement,
        key: 5,
      });
    } else {
      api.error({
        message: redemptionMsg,
        onClose: redemptionActions.resetMessage(redemptionDispatch),
        placement,
        key: 6,
      });
    }
  };

  const issuerStatusToast = (placement) => {
    if (issuerStatusSuccess) {
      api.success({
        message: issuerStatusMsg,
        onClose: issuerStatusActions.resetMessage(issuerStatusDispatch),
        placement,
        key: 7,
      });
    } else {
      api.error({
        message: issuerStatusMsg,
        onClose: issuerStatusActions.resetMessage(issuerStatusDispatch),
        placement,
        key: 8,
      });
    }
  };

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
        const borrowedAmount = (record?.escrow?.borrowedAmount || 0);
        const callDetailPage = () => {
          navigate(
            `${naviroute
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
                <div className="flex items-center gap-2">
                  Borrowed Amount: {USDSTIcon}
                  {(borrowedAmount / Math.pow(10, 18)).toFixed(2)}
                </div>
              </>
            )}
          </>
        );
      },
    },
    {
      title: 'Category',
      render: (text, record) => {
        const parts = record.contract_name.split('-');
        const contractName = parts[parts.length - 1];
        return <div>{contractName}</div>;
      },
    },
    {
      title: 'Price',
      align: 'center',
      render: (_, record) => {
        const is18DecimalPlaces = assetsWithEighteenDecimalPlaces.includes(
          record.originAddress
        );
        const price = record.price
          ? is18DecimalPlaces
            ? parseFloat(record.price * 10 ** 18).toFixed(2)
            : record.price
          : 'N/A';
        return (
          <div>
            {price !== 'N/A' ? (
              <>
                <span>${price}</span>{' '}
                <p className="flex text-xs items-center gap-1">
                  {' '}
                  &nbsp;({price} {USDSTIcon})
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
        const is18DecimalPlaces = assetsWithEighteenDecimalPlaces.includes(
          record.originAddress
        );
        const quantity = (
          is18DecimalPlaces
            ? new BigNumber(record.quantity).dividedBy(
                new BigNumber(10).pow(18)
              )
            : new BigNumber(record.quantity)
        )
          .toNumber()
          .toLocaleString('en-US', {
            maximumFractionDigits: 4,
            minimumFractionDigits: 0,
          });
        return <div>{quantity || 0}</div>;
      },
    },
    {
      title: 'Listed for Sale',
      align: 'center',
      render: (_, record) => {
        const is18DecimalPlaces = assetsWithEighteenDecimalPlaces.includes(
          record.originAddress
        );
        const saleQuantity = (
          is18DecimalPlaces
            ? new BigNumber(record.saleQuantity || 0).dividedBy(
                new BigNumber(10).pow(18)
              )
            : new BigNumber(record.saleQuantity || 0)
        ).toString();

        return <div className="w-24">{saleQuantity}</div>;
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
            category={category}
            allSubcategories={allSubcategories}
            user={user}
            supportedTokens={supportedTokens}
            reserves={reserves}
            assetsWithEighteenDecimalPlaces={assetsWithEighteenDecimalPlaces}
          />
        </div>
      ),
    },
    {
      title: 'Status',
      align: 'center',
      render: (text, record) => (
        <div className="pt-[7px] lg:pt-0 items-center gap-[5px]">
          {record.price || record?.escrow?.maxLoanAmount ? (
            <div className="flex items-center justify-center gap-2 bg-[#1548C329] p-[6px] rounded-md">
              <div className="w-[7px] h-[7px] rounded-full bg-[#119B2D]"></div>
              <p className="text-[#4D4D4D] text-[13px]">
                {' '}
                {record?.escrow?.maxLoanAmount ? 'Staked' : 'Published'}{' '}
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

  const Rewards = () => {
    return (
      <div className="flex flex-row">
        <p className="flex items-center ml-4 font-semibold text-base xl:text-lg bg-[#E6F0FF] border border-[#13188A] rounded-md px-3 py-1 text-[#13188A] shadow-sm">
          <TrophyOutlined className="!text-[#13188A] mr-2 text-lg" />
          Total Rewards: &nbsp;{logo}
          <span className="ml-1 font-bold">
            {totalCataReward.toLocaleString('en-US', {
              maximumFractionDigits: 4,
              minimumFractionDigits: 0,
            })}
          </span>
        </p>

        <p className="flex items-center ml-4 font-semibold text-base xl:text-lg bg-[#FFE6E6] border border-[#D32F2F] rounded-md px-3 py-1 text-[#D32F2F] shadow-sm">
          <GiftOutlined className="!text-[#D32F2F] mr-2 text-lg" />
          Est. Daily Reward: &nbsp;{logo}
          <span className="ml-1 font-bold">
            {dailyCataReward.toLocaleString('en-US', {
              maximumFractionDigits: 4,
              minimumFractionDigits: 0,
            })}
          </span>
        </p>
      </div>
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
      <>
        <Breadcrumb className="mx-5 md:mx-14 mt-2 lg:mt-4">
          <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
            <ClickableCell href={routes.Marketplace.url}>
              <p className="text-sm text-[#13188A] font-semibold">Home</p>
            </ClickableCell>
          </Breadcrumb.Item>
          <Breadcrumb.Item>
            <p className="text-sm text-[#202020] font-medium">My Wallet</p>
          </Breadcrumb.Item>
        </Breadcrumb>
        <div className="mt-5 ml-5 flex xl:hidden">
          <Rewards />
        </div>
        <div className="w-full h-[160px] py-4 px-4 md:h-[96px] bg-[#F6F6F6] flex flex-col md:flex-row md:px-14 justify-between items-center mt-6 lg:mt-8">
          <div className="flex w-full items-center">
            <Button
              className="!px-1 md:!px-0 flex items-center flex-row-reverse gap-[6px] text-lg md:text-xl font-semibold !text-[#13188A]"
              type="link"
              icon={
                <img
                  src={Images.ForwardIcon}
                  alt={metaImg}
                  title={metaImg}
                  className="hidden md:block w-5 h-5"
                />
              }
            >
              My Wallet
            </Button>
            <div className="hidden xl:flex">
              <Rewards />
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-3 items-center my-2 md:my-0">
            <div className="flex gap-3 items-center">
              <Select
                loading={areNotOnboardedLoading}
                className="items-select"
                style={{ width: 250, height: 40 }}
                onChange={handleChange}
                value={'Connect to Payment Provider'}
              >
                {sortedPaymentServices.map((service) => (
                  <Option
                    key={service.serviceName}
                    value={service.serviceName}
                    disabled={!service.isNotOnboarded}
                  >
                    {service.serviceName}
                    {!service.isNotOnboarded && (
                      <CheckCircleOutlined
                        style={{
                          color: '#28a745',
                          position: 'absolute',
                          right: '10px',
                        }}
                      />
                    )}
                  </Option>
                ))}
              </Select>
            </div>
            <div className="flex gap-3 items-center">
              <Button
                type="primary"
                id="createItem"
                className="w-[250px] sm:w-40 flex items-center justify-center gap-[6px]"
                style={{ height: 40 }}
                onClick={() => {
                  if (
                    hasChecked &&
                    !isAuthenticated &&
                    loginUrl !== undefined
                  ) {
                    window.location.href = loginUrl;
                  } else if (issuerStatus != ISSUER_STATUS.AUTHORIZED) {
                    showReqModModal();
                  } else {
                    showModal();
                  }
                }}
              >
                <div className="flex items-center justify-center gap-[6px]">
                  <img
                    src={Images.CreateInventory}
                    alt={metaImg}
                    title={metaImg}
                    className="w-[18px] h-[18px]"
                  />
                  Create Item
                </div>
              </Button>
            </div>
          </div>
        </div>
        <div className="">
          <Space.Compact
            className="mx-6 md:mx-5 md:px-10 mt-5 flex"
            size="large"
          >
            <Select
              defaultValue="All"
              style={{ width: 170, height: 'auto' }}
              onChange={handleTabSelect}
              options={[
                { label: 'All', value: 'All' },
                ...categorys.map((category) => ({
                  label: category.name,
                  value: category.name,
                })),
              ]}
              value={category}
            />
            <Input
              placeholder="Search"
              type="search"
              defaultValue={debouncedSearchTerm}
              onChange={queryHandleChange}
              onPressEnter={queryHandleEnter}
              className="bg-[#F6F6F6]"
              suffix={
                <img
                  src={Images.Header_Search}
                  alt={SEO.TITLE_META}
                  title={SEO.TITLE_META}
                  className="w-[18px] h-[18px]"
                />
              }
            />
          </Space.Compact>
          <div className="pt-6 mx-6 md:mx-5 md:px-10 mb-5">
            <Checkbox className="mb-4" onChange={handlePublishedCheckboxChange}>
              Published
            </Checkbox>
            <Checkbox
              className="pl-4"
              checked={showStakeable === 'true'}
              onChange={handleStakeableCheckboxChange}
            >
              Stakeable
            </Checkbox>
            <div className="hidden md:block">
              <Table
                columns={columns}
                dataSource={showPublished ? userInventories : inventories}
                loading={
                  isInventoriesLoading ||
                  isUserInventoriesLoading ||
                  isReservesLoading
                }
                className="custom-table"
                pagination={false}
              />
              <Pagination
                current={page}
                onChange={onPageChange}
                total={showPublished ? userInventoriesTotal : inventoriesTotal}
                showTotal={(total) => `Total ${total} items`}
                className="flex justify-center my-5 custom-pagination"
              />
            </div>
            <div className="md:hidden">
              <div className="my-4 grid grid-cols-1 md:grid-cols-2 gap-6 lg:grid-cols-3 3xl:grid-cols-4 5xl:grid-cols-5 sm:place-items-center md:place-items-start inventoryCard max-w-full">
                {!showPublished ? (
                  !isInventoriesLoading && !isFetchingTokens ? (
                    inventories.map((inventory, index) => (
                      <InventoryCard
                        id={index}
                        limit={limit}
                        offset={offset}
                        inventory={inventory}
                        category={category}
                        key={index}
                        debouncedSearchTerm={debouncedSearchTerm}
                        allSubcategories={allSubcategories}
                        user={user}
                        supportedTokens={supportedTokens}
                        reserves={reserves}
                        assetsWithEighteenDecimalPlaces={
                          assetsWithEighteenDecimalPlaces
                        }
                      />
                    ))
                  ) : (
                    <Spin size="large" />
                  )
                ) : null}
                {showPublished ? (
                  !isUserInventoriesLoading && !isFetchingTokens ? (
                    userInventories.map((inventory, index) => (
                      <InventoryCard
                        id={index}
                        limit={limit}
                        offset={offset}
                        inventory={inventory}
                        category={category}
                        key={index}
                        debouncedSearchTerm={debouncedSearchTerm}
                        allSubcategories={allSubcategories}
                        user={user}
                        supportedTokens={supportedTokens}
                        reserves={reserves}
                        assetsWithEighteenDecimalPlaces={
                          assetsWithEighteenDecimalPlaces
                        }
                      />
                    ))
                  ) : (
                    <Spin size="large" />
                  )
                ) : null}
                <div className="flex justify-center pt-6">
                  <Pagination
                    current={page}
                    onChange={onPageChange}
                    total={
                      showPublished ? userInventoriesTotal : inventoriesTotal
                    }
                    showSizeChanger={false}
                    className="flex justify-center my-5"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </>
      {open && (
        <CreateInventoryModal
          open={open}
          handleCancel={handleCancel}
          categorys={categorys}
          debouncedSearchTerm={debouncedSearchTerm}
          resetPage={onPageChange}
          page={page}
          categoryName={category}
        />
      )}
      {reqModOpen && (
        <RequestBeAuthorizedIssuerModal
          open={reqModOpen}
          handleCancel={handleReqModCancel}
          commonName={user.commonName}
          emailAddr={user.email}
          issuerStatus={issuerStatus}
          setIssuerStatus={setIssuerStatus}
        />
      )}
      {message && openToast('bottom')}
      {itemMsg && itemToast('bottom')}
      {redemptionMsg && redemptionToast('bottom')}
      {issuerStatusMsg && issuerStatusToast('bottom')}
    </>
  );
};

export default Inventory;
