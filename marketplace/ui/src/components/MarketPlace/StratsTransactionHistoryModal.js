import React, { useEffect } from "react";
import { Modal, Spin } from "antd";
import { useMarketplaceDispatch, useMarketplaceState } from "../../contexts/marketplace";
import { actions } from "../../contexts/marketplace/actions";
import { actions as userActions } from "../../contexts/users/actions";
import { useUsersDispatch, useUsersState } from "../../contexts/users";
import DataTableComponent from "../DataTableComponent";
import moment from "moment"


const StratsTransactionHistoryModal = ({ visible, onCancel }) => {
    const marketplaceDispatch = useMarketplaceDispatch();
    const userDispatch = useUsersDispatch();
    const {
        isFetchingStratsTransactionHistory,
        stratsTransactionHistory
    } = useMarketplaceState();
    const {
        users
    } = useUsersState();

    useEffect(() => {
        actions.fetchStratsTransactionHistory(marketplaceDispatch);
    }, [marketplaceDispatch]);

    useEffect(() => {
        userActions.fetchUsers(userDispatch);
    }, []);

    const data = stratsTransactionHistory.map((r) => {
        const displayName = (addr) => {
            const user = users.find((u) => u.userAddress == addr)
            if (user) { return `${user.commonName}` }
            else {
                if (addr == '0000000000000000000000000000000000000000') { return 'RESERVE' }
                else { return addr }
            }
        }
        
        return {
            key: r.id,
            ...r,
            value: parseInt(r._value).toLocaleString(),
            to: displayName(r._to),
            from: displayName(r._from),
            timestamp: moment.unix(r.timestamp).format('MM-DD-YYYY hh:mm a'),
            assetName: r._assetName ? r._assetName : 'N/A',
            price: r._price ? r._price : 'N/A'
        }
    }).reverse()

    const columns = [
        {
            title: 'Transfer Number',
            dataIndex: 'id',
            align: 'center'
        },
        {
            title: 'From',
            dataIndex: 'from',
            align: 'center'
        },
        {
            title: 'To',
            dataIndex: 'to',
            align: 'center'
        },
        {
            title: 'Date',
            dataIndex: 'timestamp',
            align: 'center'
        },
        {
            title: 'Asset Name',
            dataIndex: 'assetName',
            align: 'center'
        },
        {
            title: 'Value',
            dataIndex: 'value',
            align: 'center'
        },
        {
            title: 'Price',
            dataIndex: 'price',
            align: 'center'
        },
    ]

    return (
        <Modal
            title="STRATS Transaction History"
            open={visible}
            centered
            onCancel={onCancel}
            footer={false}
            width={1200}
        >
            <Spin
                spinning={isFetchingStratsTransactionHistory}
                size='large'
            >
                <DataTableComponent
                    columns={columns}
                    data={data}
                    isLoading={isFetchingStratsTransactionHistory}
                    pagination={false}
                    scrollX="100%"
                />
            </Spin>
        </Modal>
    );
}


export default StratsTransactionHistoryModal;
