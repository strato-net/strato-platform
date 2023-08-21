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

const { Search } = Input;
const { Title, Text } = Typography;

const Membership = () => {
    const [open, setOpen] = useState(false);
      const dispatch = useMembershipDispatch();
    const [api, contextHolder] = notification.useNotification();
    const [queryValue, setQueryValue] = useState("");
    const limit = 10;
    const [offset, setOffset] = useState(0);
    const [isSearch, setIsSearch] = useState(false);
    const [page, setPage] = useState(1);
    const [total, setTotal] = useState(10);
    const debouncedSearchTerm = useDebounce(queryValue, 1000);

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
                // onClose: actions.resetMessage(dispatch), //Do not have disptach yet, once we have it, we can use this
                placement,
                key: 1,
            });
        } else {
            api.error({
                message: message,
                // onClose: actions.resetMessage(dispatch), //Do not have disptach yet, once we have it, we can use this
                placement,
                key: 2,
            });
        }
    };

    let { memberships, ismembershipsLoading, message, success } = useMembershipState();
    //We want to show all inventories associated to a membership, but also
    //All memberships that do not have inventories

    //So we create a new list of memberships, creating a new object for each inventory
    //and then we flatten the list
    const membershipsAsInventories = (memberships.filter((membership_) => membership_.inventories.length > 0).map((membership_) => { return membership_.inventories.map((inventory) => { return {...membership_, ...inventory  } }) })).flat();;
    //Then we combine lists of memberships that do not have inventories with the list of inventories/memberhsips
    memberships = [...memberships.filter((membership_) => membership_.inventories.length === 0), ...membershipsAsInventories];
    
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

    const handleCancel = () => {
        setOpen(false);
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

    return (
        <>
            {contextHolder}
            {ismembershipsLoading || iscategorysLoading || issubCategorysLoading ? (
                <div className="h-screen flex justify-center items-center">
                    <Spin spinning={ismembershipsLoading} size="large" />
                </div>
            ) : (
                <div className="mx-16 mt-14 h-screen">
                    {memberships.length === 0 && offset === 0 ? (
                        <div className="h-screen justify-center flex flex-col items-center">
                            <Image src={Images.noProductSymbol} preview={false} />
                            <Title level={3} className="mt-2">
                                No product found
                            </Title>
                            <Text className="text-sm">Start adding your product</Text>
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
                    ) : (
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
                                    <div>
                                        <Typography.Text style={{ fontSize: '7px' }}>
                                            {memberships.length}  Memberships found
                                        </Typography.Text>
                                    </div>
                                </Col>
                                <Col>
                                    <Button
                                        id="add-product-button"
                                        type="primary"
                                        style={{ backgroundColor: '#6e7ddd', color: 'white', margin: '10px', fontWeight: 'bold' }}
                                        className="w-50 h-9 bg-500 !hover:bg-primaryHover ml-40"
                                    >
                                        <span style={{ fontWeight: 'normal' }}>Connect with </span>
                                        <span style={{ fontWeight: '900', margin: '1px' }}>  Stripe</span>
                                    </Button>
                                    <Dropdown.Button
                                        style={{ margin: '10px' }}
                                        icon={<DownOutlined />}
                                        menu={{ dummyData }}
                                    >
                                        All
                                    </Dropdown.Button>
                                </Col>
                                <div className="flex">
                                    <Button
                                        id="add-product-button"
                                        type="primary"
                                        style={{ backgroundColor: 'red', color: 'white', margin: '10px' }}
                                        className="w-50 h-9 bg-500 !hover:bg-primaryHover m-6"
                                    >Create Services</Button>
                                    <Button
                                        id="add-product-button"
                                        type="primary"
                                        style={{ backgroundColor: 'green', color: 'white', margin: '10px' }}
                                        className="w-50 h-9 bg-500 !hover:bg-primaryHover m-6"
                                    >Sell Existing Membership </Button>
                                    <Button id="add-product-button" type="primary" className="w-50 h-9 bg-500 !hover:bg-primaryHover m-6"
                                        style={{ backgroundColor: 'blue', color: 'white', margin: '10px' }}
                                        onClick={() => {
                                            if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                                                window.location.href = loginUrl;
                                            } else {
                                                showModal()
                                            }
                                        }}
                                    >
                                        Create New Membership
                                    </Button>
                                </div>
                            </div>
                            <>
                                {memberships.length !== 0 ? (
                                    <div className="my-4">
                                        {memberships.map((product, index) => {
                                            return (
                                                <MembershipCard
                                                    membership={product}
                                                    categorys={categorys}
                                                    subCategorys={subCategorys}
                                                    key={index}
                                                    debouncedSearchTerm={debouncedSearchTerm}
                                                />
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <p className="flex justify-center my-10"> No data found</p>
                                )}
                                <Pagination
                                    current={page}
                                    onChange={onPageChange}
                                    total={total}
                                    className="flex justify-center my-5 "
                                />
                                <div className="pb-12"></div>
                            </>
                        </>
                    )}
                </div>
            )}
            {open && (
        <CreateMembershipModal
          open={open}
          handleCancel={handleCancel}
          categorys={categorys}
          resetPage={onPageChange}
          page={page}
          debouncedSearchTerm={debouncedSearchTerm}
        />
      )}
       {message && openToast("bottom")}
        </>
    );
};

export default Membership;