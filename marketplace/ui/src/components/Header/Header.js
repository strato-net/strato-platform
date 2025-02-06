import React, { useState, useEffect, useRef } from 'react';
import { BigNumber } from 'bignumber.js';
import {
  Layout,
  Input,
  Menu,
  Space,
  Badge,
  Dropdown,
  Button,
  Typography,
  Select,
  Row,
  Col,
} from 'antd';
import {
  ArrowLeftOutlined,
  LogoutOutlined,
  RiseOutlined,
} from '@ant-design/icons';
import { useLocation, useNavigate } from 'react-router-dom';
import TagManager from 'react-gtm-module';
// actions
import { actions as marketplaceActions } from '../../contexts/marketplace/actions';
import { actions as categoryActions } from '../../contexts/category/actions';
import { actions as userActions } from '../../contexts/authentication/actions';
// Dispatches
import {
  useMarketplaceState,
  useMarketplaceDispatch,
} from '../../contexts/marketplace';
import {
  useAuthenticateDispatch,
  useAuthenticateState,
} from '../../contexts/authentication';
import { useCategoryDispatch, useCategoryState } from '../../contexts/category';
// other
import { SEO } from '../../helpers/seoConstant';
import LoginModal from '../MarketPlace/LoginModal';
import { setCookie } from '../../helpers/cookie';

import { navItems } from '../../helpers/constants';
import routes from '../../helpers/routes';
import { Images } from '../../images';
import './header.css';

const { Header } = Layout;

const HeaderComponent = ({
  user,
  loginUrl,
  showMenu,
  handleSubMenu,
  handleMenuTab,
}) => {
  const location = useLocation();
  const navigate = useNavigate();
  const IMG_META = SEO.TITLE_META;
  const inputRef = useRef(null);

  const getCategoryFromURL = () => {
    if (window.location.pathname.includes('/c/')) {
      const parts = window.location.pathname.split('/');
      return parts[parts.length - 1];
    } else {
      return 'All';
    }
  };

  const categoryQueryValue = getCategoryFromURL();

  const queryParams = new URLSearchParams(location.search);
  const searchQueryValue = queryParams.get('s') || '';
  //Dispatch
  const marketplaceDispatch = useMarketplaceDispatch();
  const categoryDispatch = useCategoryDispatch();
  const userDispatch = useAuthenticateDispatch();
  //States
  const { cartList, USDST, cata, USDSTAddress } = useMarketplaceState();
  const { categorys } = useCategoryState();
  let { isAuthenticated } = useAuthenticateState();

  useEffect(() => {
    marketplaceActions.fetchAssetsWithEighteenDecimalPlaces(
      marketplaceDispatch
    );
    if (user) {
      marketplaceActions.fetchUSDSTBalance(marketplaceDispatch);
      marketplaceActions.fetchCataBalance(marketplaceDispatch);
      marketplaceActions.fetchUSDSTAddress(marketplaceDispatch);
      marketplaceActions.fetchCataAddress(marketplaceDispatch);
    }
  }, [user]);

  useEffect(() => {
    marketplaceActions.fetchCartItems(marketplaceDispatch, cartList);
  }, [marketplaceDispatch, cartList]);

  const [selectedTab, setSelectedTab] = useState('0');
  const [roleIndex, setRoleIndex] = useState();
  const [showSearch, setShowSearch] = useState(false);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(categoryQueryValue);
  const [isModalVisible, setIsModalVisible] = useState(false);
  const USDSTBalance = Object.keys(USDST).length > 0 ? USDST : 0;
  const cataBalance = Object.keys(cata).length > 0 ? cata : 0;

  useEffect(() => {
    setSelectedCategory(categoryQueryValue);
  }, [categoryQueryValue]);

  const navUrls = [
    routes.Marketplace.url,
    routes.Transactions.url,
    routes.MyWallet.url,
    routes.ActivityFeed.url,
    routes.MyWalletStakeable.url,
  ];

  const logout = () => {
    window.LOQ = window.LOQ || [];
    window.LOQ.push([
      'ready',
      async (LO) => {
        // Track an event
        await LO.$internal.ready('events');
        LO.events.track('Logout');
      },
    ]);
    TagManager.dataLayer({
      dataLayer: {
        event: 'logout',
      },
    });
    userActions.logout(userDispatch);
  };

  useEffect(() => {
    let pathName = window.location.pathname;
    if (pathName.includes('/transactions')) {
      setSelectedTab('1');
    } else if (pathName.includes('/mywallet')) {
      setSelectedTab('2');
    } else if (pathName.includes('/activityFeed')) {
      setSelectedTab('3');
    } else {
      setSelectedTab('0');
    }
    categoryActions.fetchCategories(categoryDispatch);
  }, [window.location.pathname]);

  useEffect(() => {
    const allCat = { label: <h1 className="h-0">All</h1>, value: 'All' };
    let categories = categorys.map(({ name, subCategories }, index) => {
      const subCat = subCategories.map((item) => item.contract).join(',');
      return {
        label: <h1 className="h-0">{name}</h1>,
        value: name,
        subCategory: subCat,
      };
    });
    categories = [allCat, ...categories];
    setCategories(categories);
  }, [categorys]);

  const items = user
    ? [
        {
          key: '4',
          label: (
            <div>
              <p>My Profile</p>
            </div>
          ),
          onClick: () =>
            navigate(
              `${routes.MarketplaceUserProfile.url.replace(
                ':commonName',
                user.commonName
              )}`
            ),
        },
        {
          key: '2',
          label: (
            <div>
              <p>{user == null ? '' : user.commonName}</p>
            </div>
          ),
        },
        {
          key: '1',
          label: (
            <div
              type="text"
              id="logout"
              className="w-full text-secondryB text-sm !hover:bg-success flex gap-2 items-center"
            >
              <div className="-rotate-90">
                <LogoutOutlined />
              </div>
              Logout
            </div>
          ),
          onClick: () => logout(),
        },
      ]
    : [
        {
          key: '2',
          label: <a href={loginUrl}> Login </a>,
        },
      ];

  const USDSTItem = [
    {
      key: '1',
      type: 'group',
      label: (
        <div>
          {user && (
            <p className="text-xs mt-1">
              USDST:{' '}
              {new BigNumber(USDSTBalance)
                .toNumber()
                .toFixed(2)
                .toLocaleString('en-US', {
                  maximumFractionDigits: 4,
                  minimumFractionDigits: 2,
                })}
            </p>
          )}
        </div>
      ),
      children: [
        {
          key: '2',
          onClick: async () => {
            navigate(
              `${routes.MarketplaceProductDetail.url
                .replace(':address', USDSTAddress)
                .replace(':name', 'USDST')}`
            );
          },
          label: (
            <div>
              {user && USDSTAddress && (
                <p className="text-xs mt-1">Buy USDST</p>
              )}
            </div>
          ),
        },
        {
          key: '3',
          onClick: async () => {
            navigate(`${routes.Transactions.url}?type=USDST`);
          },
          label: (
            <div>
              {user && <p className="text-xs mt-1">Transaction History</p>}
            </div>
          ),
        },
      ],
    },
  ];

  const cataItem = [
    {
      key: '1',
      label: (
        <>
          {user && (
            <Row className="flex flex-col">
              <Col Col={24}>
                {' '}
                <p className="text-xs mt-1">
                  CATA: {new BigNumber(cataBalance).toFixed(4).toString()}
                </p>
              </Col>
            </Row>
          )}
        </>
      ),
    },
  ];

  useEffect(() => {
    if (user) setRoleIndex(0);
    else setRoleIndex(1);
  }, [user]);

  const subMenuItems = [
    {
      value: 'transactions',
      path: routes.Transactions.url,
      label: 'My Transactions',
    },
    { value: 'mywallet', path: routes.MyWallet.url, label: 'My Wallet' },
    user
      ? {
          value: 'my-profile',
          path: routes.MarketplaceUserProfile.url.replace(
            ':commonName',
            user.commonName
          ),
          label: (
            <div>
              <p className="!mb-0"> My Profile </p>
            </div>
          ),
        }
      : null,
    user ? { value: 'stake', path: routes.Stake.url, label: 'Stake' } : null,
    {
      value: 'activityFeed',
      path: routes.ActivityFeed.url,
      label: 'Activity Feed',
    },
    user
      ? {
          value: 'logout',
          path: '/logout',
          label: (
            <div>
              <p className="text-gray">{user?.commonName}</p>
              <p className="!mb-0">Logout</p>
            </div>
          ),
        }
      : null,
  ].filter(Boolean);

  const handleIntMenuTab = (data) => {
    if (roleIndex === 1 && data.value !== 'activityFeed') {
      // User is not logged in
      setSelectedTab(1);
      setIsModalVisible(true);
    } else {
      data.value === 'logout' ? logout() : navigate(data.path);
      handleMenuTab(data);
    }
  };

  const handleSearchShow = (status) => {
    setShowSearch(status);
  };

  const navigateSearch = (selectedCateg, value) => {
    const baseUrl = new URL(`/c/${selectedCateg}`, window.location.origin);

    if (selectedCateg && selectedCateg !== 'All') {
      const subCat = categorys
        .find((item) => item.name === selectedCateg)
        ?.subCategories.map((item) => item.contract)
        .join(',');
      if (subCat) {
        baseUrl.searchParams.set('sc', subCat);
      }
    }
    if (value.length > 0) {
      baseUrl.searchParams.set('s', value);
    }

    const url = baseUrl.pathname + baseUrl.search;
    navigate(url, { replace: true });
  };

  const handleChangeSearch = (e) => {
    const value = e.target.value;
    if (value.length === 0 && searchQueryValue) {
      navigateSearch('All', value);
    }
  };

  const handleEnterSearch = (e) => {
    const value = e.target.value;
    const baseUrl = new URL(`/c/All`, window.location.origin);
    if (value) {
      baseUrl.searchParams.set('s', value);
      const url = baseUrl.pathname + baseUrl.search;
      navigate(url, { replace: true });
    }
  };

  const handleCategoryChange = (cat) => {
    setSelectedCategory(cat);
    navigateSearch(cat, '');
    inputRef.current.focus();
    inputRef.current.select();
  };

  const handleLogin = () => {
    // Redirect to login page or handle login logic
    setIsModalVisible(false);
    if (!isAuthenticated && loginUrl !== undefined) {
      setCookie('returnUrl', navUrls[selectedTab], 10);
      window.location.href = loginUrl;
    }
  };

  const handleClose = () => {
    setSelectedTab('0');
    setIsModalVisible(false);
  };

  return (
    <>
      <Header
        className={`fixed z-[100] !bg-[#ffffff] !pl-2 w-full !pr-4 md:px-12 flex md:!mb-10 ${
          showMenu ? '' : 'shadow-header'
        } items-center justify-between md:justify-start`}
      >
        <Row className="relative flex-grow-0 md:flex-1 ml-2 md:ml-5">
          <Col
            xs={20}
            md={10}
            lg={4}
            className="mt-2 mr-5 md:mt-0 cursor-pointer flex-grow-0 w-max md:w-[170px] h-[44px] logo"
            onClick={() => {
              navigate(routes.Marketplace.url);
              window.scrollTo(0, 0);
            }}
          >
            <img
              src={Images.marketplaceLogo}
              alt={IMG_META}
              title={IMG_META}
              className="h-[40px] w-[150px] md:w-[170px] md:h-[44px] object-contain logo-image"
              preview={false}
            />
          </Col>
          <Col
            xs={showSearch ? 24 : 4}
            md={12}
            lg={18}
            className={`lg:ml-4 mf:ml-20 md:ml-1 bg-[#F6F6F6] shadow-md flex-1 header-search ${
              showSearch
                ? ' fixed top-[13px] left-0 flex w-[100vw] z-50 mb-2'
                : 'hidden md:flex '
            }`}
          >
            <Select
              defaultValue="All"
              className="border-none header-category"
              dropdownStyle={{ position: 'fixed' }}
              style={{ width: 170 }}
              onChange={handleCategoryChange}
              options={categories}
              value={selectedCategory}
            />
            <Input
              key={searchQueryValue || categoryQueryValue}
              ref={inputRef}
              size="large"
              type="search"
              placeholder="Search"
              defaultValue={searchQueryValue}
              onChange={(e) => {
                handleChangeSearch(e);
              }}
              onPressEnter={(e) => {
                handleEnterSearch(e);
              }}
              suffix={
                showSearch ? (
                  <ArrowLeftOutlined onClick={() => handleSearchShow(false)} />
                ) : (
                  <img
                    src={Images.Header_Search}
                    alt={IMG_META}
                    title={IMG_META}
                    className="w-[18px] h-[18px]"
                  />
                )
              }
              className="bg-[#F6F6F6] outline-none"
            />
          </Col>
        </Row>
        <Menu
          mode="horizontal"
          selectedKeys={selectedTab}
          disabledOverflow={true}
          className="h-16 bg-white text-base mx-10 md:flex hidden"
          onClick={(item) => {
            setSelectedTab(item.key);
            if (roleIndex === 1 && item.key !== '3') {
              // User is not logged in
              setIsModalVisible(true);
            } else {
              // These pages will be tracked automatically with lucky orange, no need to create an event here unless we want to include additional metadata
              if (item.key === '1') {
                TagManager.dataLayer({
                  dataLayer: {
                    event: 'view_orders_page',
                  },
                });
              }
              if (item.key === '2') {
                TagManager.dataLayer({
                  dataLayer: {
                    event: 'view_inventory_page',
                  },
                });
              }
              if (item.key === '3') {
                TagManager.dataLayer({
                  dataLayer: {
                    event: 'view_global_transactions_page',
                  },
                });
              }
              navigate(navUrls[item.key]);
            }
          }}
          items={navItems}
        />
        <Button
          type="primary"
          className="font-semibold hidden md:block"
          onClick={() => {
            window.scrollTo({ top: 0 });
            navigate(routes.Stake.url);
            setSelectedTab(0);
          }}
        >
          <RiseOutlined /> Stake
        </Button>
        <Space size="large" className="!gap-0 md:!gap-4 mr-0 -ml-3">
          {
            <div
              className="flex md:hidden mx-2"
              onClick={() => handleSearchShow(true)}
            >
              <img
                src={Images.Responsive_search}
                alt={IMG_META}
                title={IMG_META}
                className="w-6 h-6"
              />
            </div>
          }
          {roleIndex !== undefined && roleIndex !== 1 && (
            <Dropdown
              menu={{ items: cataItem }}
              placement="bottomRight"
              trigger={['click']}
              className="xs:mt-5 md:mt-0"
              overlayStyle={{ position: 'fixed' }}
            >
              <a
                className="md:flex mx-1 text-base text-white"
                id="USDST-dropdown"
              >
                <Badge
                  style={{ backgroundColor: '#13188A' }}
                  className="cursor-pointer mt-7 md:mt-0 mx-2"
                  count={
                    parseFloat(cataBalance).toString().includes('.') &&
                    parseFloat(cataBalance).toString().split('.')[1].length > 4
                      ? `${parseFloat(cataBalance).toFixed(4)}`
                      : parseFloat(cataBalance)
                          .toFixed(4)
                          .replace(/\.?0+$/, '')
                  }
                  overflowCount={9999999}
                >
                  <img
                    src={Images.cata}
                    alt={IMG_META}
                    title={IMG_META}
                    className="w-[35px] h-[35px] "
                  />
                </Badge>
              </a>
            </Dropdown>
          )}
          {roleIndex !== undefined && roleIndex !== 1 && (
            <Dropdown
              menu={{ items: USDSTItem }}
              placement="bottomRight"
              trigger={['click']}
              className="xs:mt-5 md:mt-0"
              overlayStyle={{ position: 'fixed' }}
            >
              <a
                className="md:flex mx-1 text-base text-white"
                id="USDST-dropdown"
              >
                <Badge
                  style={{ backgroundColor: '#13188A' }}
                  className="cursor-pointer mt-7 md:mt-0 mx-2"
                  count={new BigNumber(USDSTBalance)
                    .toNumber()
                    .toFixed(2)
                    .toLocaleString('en-US', {
                      maximumFractionDigits: 4,
                      minimumFractionDigits: 2,
                    })}
                  overflowCount={9999999}
                >
                  <img
                    src={Images.USDST}
                    alt={IMG_META}
                    title={IMG_META}
                    className="w-[35px] h-[35px] "
                  />
                </Badge>
              </a>
            </Dropdown>
          )}
          {roleIndex === undefined || roleIndex === 1 ? (
            loginUrl ? (
              <a
                href={loginUrl}
                id="Login"
                className="text-base text-white flex gap-3 items-center"
                onClick={() => {
                  TagManager.dataLayer({
                    dataLayer: {
                      event: 'login_register_click',
                    },
                  });
                }}
              >
                <Button
                  size="large"
                  className="hidden sm:flex login_btn w-[70%] md:w-[100%] hover:bg-primary"
                >
                  Login
                </Button>
                <Button
                  size="large"
                  className="hidden sm:flex bg-primary text-white w-[70%] md:w-[100%]"
                >
                  Register
                </Button>
                <Button
                  size="large"
                  className="flex sm:hidden bg-primary text-white w-[90%] !h-[25%] !text-sm justify-center items-center"
                >
                  Login/Register
                </Button>
              </a>
            ) : null
          ) : (
            <Dropdown
              menu={{ items }}
              placement="bottomRight"
              trigger={['click']}
              overlayStyle={{ marginTop: '40px', position: 'fixed' }}
            >
              <a
                onClick={(e) => e.preventDefault()}
                className="hidden md:flex text-base text-white"
                id="user-dropdown"
              >
                <img
                  src={Images.Setting_icon}
                  alt={IMG_META}
                  title={IMG_META}
                  className="w-[30px] h-[30px] "
                />
              </a>
            </Dropdown>
          )}
          {
            <div className="block md:hidden px-1" onClick={handleSubMenu}>
              <img
                src={Images.menu_icon}
                alt={IMG_META}
                title={IMG_META}
                className="w-6 h-6"
              />
            </div>
          }
        </Space>
      </Header>
      {showMenu && (
        <div className="fixed inset-x-0 z-50 md:hidden">
          <div className="bg-white border-t border-[#E9E9E9] absolute w-full z-50 md:hidden top-16">
            {subMenuItems.map((item) => (
              <Typography
                onClick={() => handleIntMenuTab(item)}
                className={`text-base py-3 px-4 cursor-pointer ${
                  item ? '' : 'hidden'
                }`}
              >
                {item?.label}
              </Typography>
            ))}
          </div>
          <div
            className="h-[100vh] w-full bg-[#00000020] absolute top-0 md:hidden z-40"
            onClick={handleMenuTab}
          ></div>
        </div>
      )}
      <LoginModal
        visible={isModalVisible}
        onCancel={handleClose}
        onLogin={handleLogin}
      />
    </>
  );
};

export default HeaderComponent;
