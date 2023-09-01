import { useEffect, useState } from "react";
import { Tabs, Input, Button } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import ActiveTab from "./ActiveTab";
import InactiveTab from "./InactiveTab";
import { actions } from "../../contexts/product/actions";
import { useProductDispatch, useProductState } from "../../contexts/product";
import useDebounce from "../UseDebounce";


const MyAssets = () => {
    const { Search } = Input;
    const dispatch = useProductDispatch();
    const { products, isProductsLoading } = useProductState();
    const limit = 10;
    const [offset, setOffset] = useState(0);
    const [queryValue, setQueryValue] = useState("");
    const debouncedSearchTerm = useDebounce(queryValue, 1000);

    useEffect(() => {
        actions.fetchProduct(dispatch, limit, offset, debouncedSearchTerm);
    }, [dispatch, limit, offset, debouncedSearchTerm]);

    const items = [
        {
            key: "1",
            label: "Active",
            children: <ActiveTab products={products} />
        },
        {
            key: "2",
            label: "Inactive",
            children: <InactiveTab products={products} />
        }
    ]

    return (
        <>
            <div className="flex mx-16">
                <Tabs items={items} defaultActiveKey="1" className="mt-6" />
            </div>
            <div className="absolute top-28 right-32">
                <Search
                    className="w-96"
                    placeholder="Search by any Keyword"
                    enterButton="Search"
                    prefix={<SearchOutlined style={{ color: "#989898" }} />}
                />
                <Button
                    className="w-32 ml-12"
                    type="primary"
                >
                    Filter
                </Button>
            </div>
        </>
    )
}


export default MyAssets;