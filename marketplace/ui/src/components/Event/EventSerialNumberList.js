import React, { useEffect, useState } from "react";
import DataTableComponent from "../DataTableComponent";
import { Typography, Breadcrumb, Input } from "antd";
import routes from "../../helpers/routes";
import { SearchOutlined } from '@ant-design/icons';
import { useLocation, useNavigate } from "react-router-dom";
import ClickableCell from "../ClickableCell";

const { Text } = Typography;

const EventSerialNumberList = ({ user }) => {
    const navigate = useNavigate();
    const { state } = useLocation();
    const { serialNumbers, eventTypeName, tab, inventoryId, eventTypeId } = state;
    const [dataList, setDataList] = useState([]);

    const serialNumberColumn = [
        {
            title: <Text className="text-primaryC text-[13px]">SERIAL NUMBER</Text>,
            dataIndex: "serialNumber",
            key: "serialNumber",
            align: "center",
            render: (text) => <p>{text}</p>
        },
    ];

    useEffect(() => {
        let tempList = serialNumbers.map((s, index) => {
            return { key: index + 1, serialNumber: s };
        });
        setDataList(tempList);
    }, [serialNumbers]);

    return (
        <div className="mx-14">
            <div className="flex justify-between items-center mt-14">
                <Breadcrumb className="mb-6">
                    <Breadcrumb.Item href="#">
                        <ClickableCell
                            href={user?.roles?.includes("Certifier") && user?.roles.length === 1 ?
                                routes.Certifier.url : routes.Marketplace.url}
                        >
                            Home
                        </ClickableCell>
                    </Breadcrumb.Item>
                    {tab === "Inventory" && <Breadcrumb.Item className="cursor-pointer" href="#">
                        <ClickableCell href={routes.Inventories.url}>Inventory</ClickableCell>
                    </Breadcrumb.Item>}
                    <Breadcrumb.Item href="#">
                        <div
                            onClick={() => {
                                if (user?.roles.includes("Certifier") && user?.roles.length === 1)
                                    navigate(-1)
                                else if(tab === "Inventory")
                                    navigate(routes.EventList.url.replace(":id",inventoryId))
                                else navigate(routes.Events.url, { state: { tab: tab } })
                            }}
                        >
                            Events
                        </div>
                    </Breadcrumb.Item>
                    <Breadcrumb.Item href="#">
                        <div
                            onClick={() => {
                                if (user?.roles.includes("Certifier") && user?.roles.length === 1)
                                    navigate(-1)
                                else if(tab === "Inventory")
                                    navigate(routes.InventoryEventDetail.url.replace(":inventoryId",inventoryId).replace(":eventTypeId",eventTypeId))
                                else navigate(routes.Events.url, { state: { tab: tab } })
                            }
                            }
                        >
                            {decodeURIComponent(eventTypeName)}
                        </div>
                    </Breadcrumb.Item>
                    <Breadcrumb.Item className="text-primary">Serial Number</Breadcrumb.Item>
                </Breadcrumb>
                <Input
                    placeholder="Search by Serial Number"
                    prefix={<SearchOutlined />}
                    size="middle"
                    className="w-80"
                />
            </div>

            <DataTableComponent
                columns={serialNumberColumn}
                data={dataList}
                isLoading={false}
                scrollX="100%"
                pagination={{
                    defaultPageSize: 10,
                    showSizeChanger: false,
                    position: ["bottomCenter"],
                }}
            />
        </div>
    );
}

export default EventSerialNumberList;