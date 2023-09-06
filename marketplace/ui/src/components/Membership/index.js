import React, { useState, useEffect } from "react";

import {
    Breadcrumb,
    Input,
    Button,
    Col,
    notification,
    Dropdown,
    Spin,
    Image,
    Typography,
    Pagination,
    Tabs
} from "antd";
import { DownOutlined } from '@ant-design/icons';
import MembershipCard from "./MembershipCard";
import CreateMembershipModal from "./CreateMembershipModal";
import { actions } from "../../contexts/membership/actions";
import { useMembershipDispatch, useMembershipState } from "../../contexts/membership";

import useDebounce from "../UseDebounce";
//categories
import { actions as categoryActions } from "../../contexts/category/actions";
import { useCategoryDispatch, useCategoryState } from "../../contexts/category";
//sub-categories
import {
    useSubCategoryState,
} from "../../contexts/subCategory";
import { Images } from "../../images";
import ClickableCell from "../ClickableCell";
import routes from "../../helpers/routes";
import { useAuthenticateState } from "../../contexts/authentication";
import { useLocation, useNavigate  } from "react-router-dom";
import PurchasedList from "./PurchasedList";

const { Search } = Input;
const { Title, Text } = Typography;

const Membership = ( user ) => {
    let { state } = useLocation();
    const [open, setOpen] = useState((state && user.user) ? state.isCalledFromHeader : false);
    useEffect(() => {
        if (state && user.user){
            setOpen(state.isCalledFromHeader);
        }
        else{
            setOpen(false);
        }
        window.history.replaceState({}, "/memberships")
    }, [state]);
    
    const dispatch = useMembershipDispatch();
    const [api, contextHolder] = notification.useNotification();
    const [queryValue, setQueryValue] = useState("");
    const limit = 10;
    const [offset, setOffset] = useState(0);
    const [isSearch, setIsSearch] = useState(false);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(10);
    const debouncedSearchTerm = useDebounce(queryValue, 1000);
    let [typeDisplay, setTypeDisplay] = useState("purchase");

    //Categories
    const categoryDispatch = useCategoryDispatch();

    //Sub-categories

    const { categorys, iscategorysLoading } = useCategoryState();
    const { subCategorys, issubCategorysLoading } = useSubCategoryState();

    let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();

    useEffect(() => {
        categoryActions.fetchCategories(categoryDispatch);
    }, [categoryDispatch]);

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

    let { memberships, ismembershipsLoading, message, success, stripeStatus, isLoadingStripeStatus } = useMembershipState();
   
    
    useEffect(() => {
        actions.sellerStripeStatus(dispatch, user?.user?.organization);
    }, [dispatch, user]);
    
    const navigate = useNavigate();
    
    const onboardSeller = async () => {
        navigate(routes.OnboardingSellerToStripe.url)
    }

    const memberships_issued = memberships
        .filter((membership_) => membership_.inventories.length > 0)
        .filter((membership) => membership.ownerOrganization === membership.inventories[0].manufacturer);

    //We want to show all inventories associated to a membership, but also
    //All memberships that do not have inventories
    //So we create a new list of memberships objects, creating a new object for each inventory
    //and then we flatten the list
    const membershipsAsInventories = (memberships
        .filter((membership_) => membership_.inventories.length > 0)
        .map((membership_) => { 
            return membership_.inventories.map((inventory) => { 
                return {...membership_, ...inventory, product_with_inventory: 1, inventoryAddress: inventory.address, membershipAddress: membership_.address  } }) }))
        .flat();
    //Then we combine lists of memberships that do not have inventories with the list of inventories/memberhsips
    memberships = [
        ...(memberships
            .filter((membership_) => membership_.inventories.length === 0))
            .map((membership_) => { 
                return {...membership_, product_with_inventory: 0, inventoryAddress: null, membershipAddress: membership_.address } })
        , ...membershipsAsInventories];
        
    useEffect(() => {
        if (isSearch) {
            setOffset(0);
              actions.fetchMembership(dispatch, limit, 0, debouncedSearchTerm);
            setIsSearch(false)
        } else
            setIsSearch(true)
          actions.fetchMembership(dispatch, limit, offset, debouncedSearchTerm);
    }, [limit, offset, debouncedSearchTerm]);

    useEffect(() => {
        let len = memberships.length;
        let total;
        if (len === limit) total = page * 10 + limit;
        else total = (page - 1) * 10 + limit;
        setTotal(total);
    }, [memberships]);

    const showModal = () => {
        hasChecked && !isAuthenticated && loginUrl !== undefined ? window.location.href = loginUrl : setOpen(true)
    };

    const handleCancel = (message) => {
        if (message === "success") {
            setOpen(false);
            actions.fetchMembership(dispatch, limit, offset, debouncedSearchTerm);
        } else {
            setOpen(false);
        }
    };

    const queryHandle = (e) => {
        setQueryValue(e.target.value);
        setIsSearch(true)
        setPage(1);
    };

    const onPageChange = (page) => {
        setOffset((page - 1) * limit);
        setPage(page);
    };
    const dummyData = [ //TODO, unhardcode this
        {              //When the utility of this
            label: 'All',//understood
            key: '1',
        },
        {
            label: 'Health',
            key: '2',
        },
    ];
    const onChange = (key) => {
        setTypeDisplay(key);
        typeDisplay = key;
      };

    useEffect(() => {
        setTypeDisplay(typeDisplay);
    })
      
    const items = [
    {
        key: 'purchase',
        label: 'Purchased',
    },
    {
        key: 'issued',
        label: 'Issued',
    }
    ];

    return (
        <>
            {contextHolder}
            {stripeStatus === null || ismembershipsLoading || iscategorysLoading || issubCategorysLoading || isLoadingStripeStatus ? (
                <div className="h-screen flex justify-center items-center">
                    <Spin spinning={ismembershipsLoading} size="large" />
                </div>
            ) : (
                <div className="mx-16 mt-14 h-screen">
                    {
                        <>
                            <div className="flex justify-between">
                                <Col>
                                    <Breadcrumb>
                                        <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
                                            <ClickableCell href={routes.Marketplace.url}>
                                                Home
                                            </ClickableCell>
                                        </Breadcrumb.Item>
                                        <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
                                            <p className="text-primary">
                                                Memberships
                                            </p>
                                        </Breadcrumb.Item>
                                    </Breadcrumb>
                                    <Typography.Text className="text-2xl">
                                        Memberships
                                    </Typography.Text>
                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                        <Typography.Text style={{ fontSize: '10px', marginRight: '80px' }}>
                                            {memberships.length}  Memberships found
                                        </Typography.Text>
                                        <Tabs defaultActiveKey="1" items={items} onChange={onChange} />
                                    </div>
                                </Col>
                                {/* <Col>

                                    <Dropdown.Button
                                        style={{ margin: '10px' }}
                                        icon={<DownOutlined />}
                                        menu={{ dummyData }}
                                    >
                                        All
                                    </Dropdown.Button>
                                    
                                </Col> */}
                                <div className="flex">
                                    <Button id="add-product-button" type="primary" className="w-50 h-9 bg-500 !hover:bg-primaryHover m-6"
                                        style={{ backgroundColor: 'blue', color: 'white', margin: '10px' }}
                                        onClick={() => {
                                            if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                                                window.location.href = loginUrl;
                                            } else {
                                                showModal()
                                            }
                                        }}>
                                        Create New Membership
                                    </Button>
                                    <Button
                                        id="add-product-button"
                                        type="primary"
                                        style={{ backgroundColor: 'green', color: 'white', margin: '10px' }}
                                        className="w-50 h-9 bg-500 !hover:bg-primaryHover m-6"
                                        >Sell Existing Membership </Button>
                                    <Button
                                        id="add-product-button"
                                        type="primary"
                                        style={{ backgroundColor: 'red', color: 'white', margin: '10px' }}
                                        className="w-50 h-9 bg-500 !hover:bg-primaryHover m-6"
                                        >Manage Services</Button>
                                    <Button
                                        id="add-product-button"
                                        type="primary"
                                        style={{ color: 'white', margin: '10px', fontWeight: 'bold' }}
                                        className="w-50 h-9 bg-500 !hover:bg-primaryHover ml-40"
                                        disabled={stripeStatus.detailsSubmitted}
                                        onClick={() => {
                                            if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                                              window.location.href = loginUrl;
                                            } else {
                                              onboardSeller()
                                            }
                                            }}
                                        >
                                        <span style={{ fontWeight: 'normal' }}> Setup  </span>
                                        <span style={{ fontWeight: '900', margin: '0 5px' }}>  Stripe  </span>
                                        <span style={{ fontWeight: 'normal' }}> Account</span>
                                    </Button>
                                </div>
                            </div>
                            <>
                                {
                                    (typeDisplay === "purchase") ?
                                        <PurchasedList 
                                        user={user}
                                        categorys={categorys}
                                        subCategorys={subCategorys}
                                        debouncedSearchTerm={debouncedSearchTerm}
                                        /> 
                                        :
                                    (<div className="my-4">
                                        { memberships.length > 0 ?
                                        memberships_issued.map((product, index) => {
                                            return (
                                                <MembershipCard
                                                    user={user}
                                                    membership={product}
                                                    categorys={categorys}
                                                    subCategorys={subCategorys}
                                                    key={index}
                                                    debouncedSearchTerm={debouncedSearchTerm}
                                                />
                                            );
                                        }
                                    )
                                    :
                                    (
                                        <>
                                        <h2 className="text-2xl font-semibold">Issued Memberships</h2>
                                        <div className="h-screen justify-center flex flex-col items-center">
                                            <Image src={Images.noProductSymbol} preview={false} />
                                            <Title level={3} className="mt-2">
                                                No product found
                                            </Title>
                                            <Text className="text-sm">Start adding your product</Text>
                                            <div className="flex items-center">
                                                <Button
                                                    type="primary"
                                                    className="w-44 h-9 bg-primary !hover:bg-primaryHover mt-6 mr-3"
                                                    onClick={() => {
                                                        if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                                                        window.location.href = loginUrl;
                                                        } else {
                                                        onboardSeller()
                                                        }
                                                    }}
                                                    disabled={stripeStatus.detailsSubmitted}
                                                    >
                                                    {"Setup Stripe Account"}
                                                </Button>
                                                <Button
                                                    id="add-product-button"
                                                    type="primary"
                                                    className="w-44 h-9 bg-primary !hover:bg-primaryHover mt-6"
                                                    onClick={() => {
                                                        if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                                                            window.location.href = loginUrl;
                                                        } else {
                                                            showModal()
                                                        }
                                                    }}
                                                >
                                                    Add Memberships
                                                </Button>
                                            </div>
                                        </div>
                                        </>
                                    )}
                                </div>)}
                                <Pagination
                                    current={page}
                                    onChange={onPageChange}
                                    total={total}
                                    className="flex justify-center my-5 "
                                />
                                <div className="pb-12"></div>
                            </>
                        </>
                    }
                </div>
            )}
            {open && (
        <CreateMembershipModal
          open={open}
          user={user}
          handleCancel={handleCancel}
        //   categorys={categorys}
        //   resetPage={onPageChange}
        //   page={page}
        //   debouncedSearchTerm={debouncedSearchTerm}
        />
      )}
       {message && openToast("bottom")}
        </>
    );
};

export default Membership;