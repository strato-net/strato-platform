import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Layout,
  Input,
  Menu,
  Space,
  Badge,
  Avatar,
  Dropdown,
  Button,
  Typography,
  Select,
  Row,
  Col
} from "antd";
import { ArrowLeftOutlined, LogoutOutlined } from "@ant-design/icons";
import { Images } from "../../images";
import "./header.css";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import routes from "../../helpers/routes";
import {
  useMarketplaceState,
  useMarketplaceDispatch,
} from "../../contexts/marketplace";
import { actions } from "../../contexts/marketplace/actions";
import { actions as categoryActions } from "../../contexts/category/actions";
import { actions as userActions } from "../../contexts/authentication/actions";
import { useAuthenticateDispatch, useAuthenticateState } from "../../contexts/authentication";
import TagManager from "react-gtm-module";
import { SEO } from "../../helpers/seoConstant";
import { useCategoryDispatch, useCategoryState } from "../../contexts/category";
import { HTTP_METHODS, apiUrl } from "../../helpers/constants";

const { Header } = Layout;

const HeaderComponent = ({ user, loginUrl, showMenu, handleSubMenu, handleMenuTab }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const IMG_META = SEO.TITLE_META
  const inputRef = useRef(null);
  
  const getCategoryFromURL = () => {
    if(window.location.pathname.includes('/c/')){
      const parts = window.location.pathname.split('/');
      return parts[parts.length - 1];
    }else{
      return 'All'
    }
  };

  const categoryQueryValue = getCategoryFromURL()

  const queryParams = new URLSearchParams(location.search);
  const searchQueryValue = queryParams.get('s') || '';
  //Dispatch
  const marketplaceDispatch = useMarketplaceDispatch();
  const categoryDispatch = useCategoryDispatch();
  const userDispatch = useAuthenticateDispatch();
  //States
  const { cartList, strats } = useMarketplaceState();
  const { categorys } = useCategoryState();
  let { isAuthenticated } = useAuthenticateState();

  const storedData = useMemo(() => {
    return window.localStorage.getItem("cartList") == null ? [] : JSON.parse(window.localStorage.getItem("cartList"));
  }, []);

  useEffect(() => {
    if (user) {
      actions.fetchStratsBalance(marketplaceDispatch);
    }
  }, [user]);

  useEffect(() => {
    actions.fetchCartItems(marketplaceDispatch, storedData);
  }, [marketplaceDispatch, storedData]);

  const [selectedTab, setSelectedTab] = useState("0");
  const [initials, setInitials] = useState("");
  const [roleIndex, setRoleIndex] = useState();
  const [showSearch, setShowSearch] = useState(false);
  const [categories, setCategories] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState(categoryQueryValue);

  const stratsBalance = (Object.keys(strats).length > 0) ? strats : 0

  useEffect(()=>{
    setSelectedCategory(categoryQueryValue)
  },[categoryQueryValue])

  const navItems = [
    {
      role: 0,
      items: [
        { label: <div id="Orders">Orders</div>, key: '0' },
        { label: <div id="Inventory">My Store</div>, key: '1' }
      ]
    },
    {
      role: 1,
      items: [ ]
    },
  ];

  const navUrls = [
    routes.Orders.url.replace(':type', 'sold'),
    routes.MyStore.url,
    routes.Products.url,
    routes.Events.url,
  ];

  const logout = () => {
    window.LOQ = window.LOQ || []
    window.LOQ.push(['ready', async LO => {
      // Track an event
      await LO.$internal.ready('events')
      LO.events.track('Logout')
    }])
    TagManager.dataLayer({
      dataLayer: {
        event: 'logout',
      },
    });
    userActions.logout(userDispatch);
  };

  useEffect(() => {
    let pathName = window.location.pathname;
    if (pathName.includes("/order") || pathName.includes("/orders") || pathName.includes('sold-orders') || pathName.includes('bought-orders')) {
      setSelectedTab("1");
    } else if (pathName.includes("/mystore")) {
      setSelectedTab("2");
    } else if (pathName.includes("/products")) {
      setSelectedTab("3");
    } else if (pathName.includes("/events") || pathName === "/certifier") {
      setSelectedTab("4");
    }
    else {
      setSelectedTab("0");
    }
    categoryActions.fetchCategories(categoryDispatch);

  }, [window.location.pathname]);

  useEffect(() => {
    const allCat = { label: 'All', value: 'All' }
    let categories = categorys.map(({ name, subCategories }, index) => {
      const subCat = subCategories.map(item=>item.contract).join(',')
      return { label: name, value: name, subCategory:subCat }
    })
    categories = [allCat, ...categories];
    setCategories(categories)
  }, [categorys])

  const items = user ? [
    {
      key: '3',
      label: (
        <div onClick={() => { navigate(`${routes.MarketplaceUserProfile.url.replace(":commonName", user.commonName)}`) }}>
          <p>My Profile</p>
        </div>
      ),
    },
    {
      key: '2',
      label: (
        <div>
          <p>
            {user == null ? "" : user.commonName}
          </p>
          <p className="text-xs">
            {user == null ? "" : user.email}
          </p>
        </div>
      ),
    },
    {
      key: '1',
      label: (
        <div type="text" id="logout" className="w-full text-secondryB text-sm !hover:bg-success flex gap-2 items-center" onClick={logout}>
          <div className="-rotate-90"><LogoutOutlined /></div>
          Logout
        </div>
      ),
    },
  ] : [
    {
      key: '2',
      label: (
        <a href={loginUrl}> Login </a>
      ),
    },
  ];

  const stratsItem = [{
    key: '2',
    label: (
      <div>
        {user &&
          <p className="text-xs mt-1">
            STRATs: {stratsBalance}
          </p>
        }
      </div>
    ),
  }]

  useEffect(() => {
    let temp = "";
    if (user != null) {
      if (user.commonName.split(" ").length > 1) {
        temp = user.commonName.split(" ")[0].substring(0, 1) + user.commonName.split(" ")[1].substring(0, 1);
      } else {
        temp = user.commonName.split(" ")[0].substring(0, 1);
      }
    }
    setInitials(temp);
  }, [user])

  useEffect(() => {
    if (user) setRoleIndex(0)
    else setRoleIndex(1)
  }, [user])

  const subMenuItems = [
    { value: "orders", path: routes.Orders.url.replace(':type', 'sold'), label: "Orders" },
    { value: "mystore", path: "/mystore", label: "My Store" },
    user ? {
      value: "my-profile",
      path: routes.MarketplaceUserProfile.url.replace(':commonName', user.commonName),
      label: (
        <div>
          <p className="!mb-0">My Profile</p>
        </div>
      )
    } : null,
    user ? {
      value: "logout",
      path: "/logout",
      label: (
        <div>
          <p className="text-gray">{user?.commonName}</p>
          <p className="text-xs text-gray">{user?.preferred_username}</p>
          <p className="!mb-0">Logout</p>
        </div>
      )
    } : null,
  ].filter(Boolean);


  const handleIntMenuTab = (data) => {
    data.value == 'logout' ? logout() : data.value == 'orders' ? navigate(routes.Orders.url.replace(':type', 'sold'), { state: { defaultKey: "Sold" } }) : navigate(data.path)
    handleMenuTab(data)
  }

  const handleSearchShow = (status) => {
    setShowSearch(status)
  }

  function getCategoryName(str) {
    const lastIndex = str.lastIndexOf('-');
    if (lastIndex !== -1) {
      return str.substring(lastIndex + 1);
    } else {
      return str;
    }
  }

  const handleNavigateRoute = (category,value) =>{
   if(category !== 'All'){
    handleCategoryChange(category)
   }  

   setSelectedCategory(category)
   navigateSearch(category, value)
  }

  const checkCategory = (value) => {
    const searchQuery = value ? `?queryValue=${value}&queryFields=name` : '';
    
    const fetchFunction = isAuthenticated
      ? fetch(
        `${apiUrl}/marketplace/all${searchQuery}`,
        { method: HTTP_METHODS.GET, } )
      : fetch(
        `${apiUrl}/marketplace${searchQuery}`,
        { method: HTTP_METHODS.GET, }
      );
     try {
      fetchFunction.then(res=>res.json().then(res=>{
        const arr = res.data.productsWithImageUrl.map(item=>
          getCategoryName(item.contract_name))
        const unique = [...new Set(arr)];
        if(arr.length>0){
          const isCarbonIncludes = (item) => item.includes('Carbon')
          const isCarbon = unique.every(isCarbonIncludes)

          if(unique.length==1 || isCarbon){
            const category = getCategoryName(unique[0])
            const cat = isCarbon?'Carbon':category
            handleNavigateRoute(cat,value)
          }else{
              handleNavigateRoute('All',value)
          }
          
        }else{
          handleNavigateRoute('All',value)
        }
      }))    
     } catch (error) {
      console.log("err",error)
     }
  };

  const navigateSearch = (selectedCateg, value) => {
    const baseUrl = new URL(`/c/${selectedCateg}`, window.location.origin);
    
    if(selectedCateg && selectedCateg!=='All'){
      const subCat = categorys.find((item)=>item.name===selectedCateg)
      ?.subCategories.map(item=>item.contract).join(',')
      if(subCat){
        baseUrl.searchParams.set('sc', subCat);
      }
    }
    if (value.length > 0) {
      baseUrl.searchParams.set('s', value);
    }

    const url = baseUrl.pathname + baseUrl.search;
    navigate(url, { replace: true });
  }

  const handleChangeSearch = (e) => {
    const value = e.target.value;
    if (value.length === 0 && searchQueryValue) {
      navigateSearch('All',value)
    }
  }

  const handleEnterSearch = (e) => {
    const value = e.target.value;
    checkCategory(value)
  };

  const handleCategoryChange = (cat) => {
    setSelectedCategory(cat)
    navigateSearch(cat,"")
    inputRef.current.focus();
    inputRef.current.select();
  }

  return (
    <>
      <Header className={`fixed z-[100] !bg-[#ffffff] !pl-2 w-full !pr-4 md:px-12 flex md:!mb-10 ${showMenu ? '' : 'shadow-header'} items-center justify-between md:justify-start`}>
        <Row className="relative flex-grow-0 md:flex-1 ml-2 md:ml-5">
          <Col xs={20} md={10} lg={4} 
            className="mt-4 mr-5 md:mt-0 cursor-pointer flex-grow-0 w-max md:w-[170px] h-[44px]"
            onClick={() => { navigate(routes.Marketplace.url) }}
          >
            <img src={Images.newLogo} alt={IMG_META} title={IMG_META} className="h-[31px] w-[120px] md:w-[170px] md:h-[44px]" preview={false} />
          </Col>
          <Col xs={showSearch ? 24 : 4} md={12} lg={18} className={`lg:ml-4 mf:ml-20 md:ml-1 bg-[#F6F6F6] shadow-md flex-1 header-search ${showSearch ? ' fixed top-[13px] left-0 flex w-[100vw] z-50 mb-2' : 'hidden md:flex '}`}>
            <Select
              defaultValue="All"
              className="border-none header-category"
              dropdownStyle={{position:'fixed'}}
              style={{ width: 170 }}
              onChange={handleCategoryChange}
              options={categories}
              value={selectedCategory}
            />
            <Input
              key={searchQueryValue}
              ref={inputRef}
              size="large"
              type="search"
              placeholder="Search"
              defaultValue={searchQueryValue}
              onChange={(e) => { handleChangeSearch(e) }}
              onPressEnter={(e) => { handleEnterSearch(e) }}
              suffix={showSearch 
                ? <ArrowLeftOutlined onClick={() => handleSearchShow(false)} /> 
                : <img src={Images.Header_Search} alt={IMG_META} title={IMG_META} className="w-[18px] h-[18px]" />}
              className="bg-[#F6F6F6] border-none outline-none"
            />
          </Col>
        </Row>
        <Menu
          mode="horizontal"
          defaultSelectedKeys={["0"]}
          selectedKeys={[selectedTab]}
          disabledOverflow={true}
          className="h-16 bg-white text-base mx-10 md:flex hidden"
          onClick={(item) => {
            setSelectedTab(item.key)
            // These pages will be tracked automatically with lucky orange, no need to create an event here unluess we want to include additional metadata
            if (item.key === "0") {
              TagManager.dataLayer({
                dataLayer: {
                  event: 'view_orders_page',
                },
              });
            }
            if (item.key === "1") {
              TagManager.dataLayer({
                dataLayer: {
                  event: 'view_inventory_page',
                },
              });
            }
            if (item.key === "2") {
              TagManager.dataLayer({
                dataLayer: {
                  event: 'view_products_page',
                },
              });
            }
            if (item.key === "3") {
              TagManager.dataLayer({
                dataLayer: {
                  event: 'view_events_page',
                },
              });
              navigate(navUrls[item.key], { state: { tab: "EventType" } })
            }
            else navigate(navUrls[item.key]);
          }}
          items={navItems[roleIndex]?.items}
        />
        <Space size="large" className="!gap-0 md:!gap-4 mr-0 -ml-3">
          {<div className="flex md:hidden mx-2" onClick={() => handleSearchShow(true)}>
            <img src={Images.Responsive_search} alt={IMG_META} title={IMG_META} className="w-6 h-6" />
          </div>}
          <Badge
            className="cursor-pointer mr-3 md:mr-1"
            count={cartList.length}
            onClick={() => {
              TagManager.dataLayer({
                dataLayer: {
                  event: 'view_shopping_cart',
                },
              });
              navigate("/checkout");
            }}
          >
            <div className="md:hidden">
              <Avatar
                icon={<img src={Images.Responsive_cart} alt={IMG_META} title={IMG_META} className="w-6 h-6" />}
              />
            </div>
            <div className="hidden md:inline-block">
              <Avatar
                icon={<img src={Images.Header_cart} alt={IMG_META} title={IMG_META} className="w-6 h-6" />}
              />
            </div>
          </Badge>

          {(roleIndex !== undefined && roleIndex !== 1)
            && <Dropdown menu={{ items: stratsItem }} placement="bottomRight" trigger={["hover", "click"]} className="xs:mt-5 md:mt-0" overlayStyle={{ position: 'fixed' }}>
              <a onClick={(e) => e.preventDefault()} className="md:flex mx-1 text-base text-white" id="user-dropdown">
              <Badge
              style={{backgroundColor:"#13188A"}}
              className="cursor-pointer mt-7 md:mt-0 mx-2"
              count={stratsBalance}
              overflowCount={9999999}
              >
              <img src={Images.logo} alt={IMG_META} title={IMG_META} className="w-[30px] h-[30px] " />
            </Badge>
              </a>
            </Dropdown>
          }
          {
            roleIndex === undefined || roleIndex === 1 ? (
              loginUrl ? <a href={loginUrl} id="Login" className="text-base text-white flex gap-3 items-center"
                onClick={() => {
                  TagManager.dataLayer({
                    dataLayer: {
                      event: 'login_register_click'
                    }
                  })
                }} >
                <Button size="large" className="hidden sm:flex login_btn w-[70%] md:w-[100%] hover:bg-primary">Login</Button>
                <Button size="large" className="hidden sm:flex bg-primary text-white w-[70%] md:w-[100%]">Register</Button>
                <Button size="large" className="flex sm:hidden bg-primary text-white w-[90%] !h-[25%] !text-sm justify-center items-center">Login/Register</Button>
              </a> : null
            ) :
              <Dropdown menu={{ items }} placement="bottomRight" trigger={["click"]} overlayStyle={{ marginTop: "40px", position: 'fixed' }}>
                <a onClick={(e) => e.preventDefault()} className="hidden md:flex text-base text-white" id="user-dropdown">
                  <img src={Images.Setting_icon} alt={IMG_META} title={IMG_META} className="w-[30px] h-[30px] " />
                </a>
              </Dropdown>
          }
          {<div className="block md:hidden px-1" onClick={handleSubMenu}>
            <img src={Images.menu_icon} alt={IMG_META} title={IMG_META} className="w-6 h-6" />
          </div>}
        </Space>
      </Header>
      {showMenu &&
        <div>
          <div className="bg-white border-t border-[#E9E9E9] absolute w-full z-50 md:hidden top-16">
            {subMenuItems.map((item) => 
                <Typography onClick={() => handleIntMenuTab(item)} className={`text-base py-3 px-4 cursor-pointer ${item ? '' : 'hidden'}`} >{item?.label}</Typography>
             )}
          </div>
          <div className="h-[100vh] w-full bg-[#00000020] absolute top-0 md:hidden z-40" onClick={handleMenuTab}></div>
        </div>
      }
    </>

  );
};

export default HeaderComponent;
