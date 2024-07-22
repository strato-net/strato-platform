import React, { useEffect } from "react";
import { Modal, Spin } from "antd";
import moment from "moment"
// Actions
import { actions as marketplaceActions } from "../../contexts/marketplace/actions";
import { actions as userActions } from "../../contexts/users/actions";
// Dispatch and States
import { useMarketplaceDispatch, useMarketplaceState } from "../../contexts/marketplace";
import { useUsersDispatch, useUsersState } from "../../contexts/users";
// Components
import DataTableComponent from "../DataTableComponent";
// Other
import { STRATS_TRANSACTION_HISTORY_TABLE_COLUMN } from "../../helpers/constants";


const StratsTransactionHistoryModal = ({ visible, onCancel }) => {
    // Dispatch
    const marketplaceDispatch = useMarketplaceDispatch();
    const userDispatch = useUsersDispatch();
    // States
    const { isFetchingStratsTransactionHistory, stratsTransactionHistory } = useMarketplaceState();
    const { users } = useUsersState();

    useEffect(() => {
        marketplaceActions.fetchStratsTransactionHistory(marketplaceDispatch);
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
            value: (parseInt(r._value) / 100).toLocaleString(),
            to: displayName(r._to),
            from: displayName(r._from),
            timestamp: moment.unix(r.timestamp).format('MM-DD-YYYY hh:mm a')
        }
    }).reverse()

    return (
        <Modal
            title="STRATS Transaction History"
            open={visible}
            centered
            onCancel={onCancel}
            footer={false}
            width={900}
        >
            <Spin
                spinning={isFetchingStratsTransactionHistory}
                size='large'
            >
                <DataTableComponent
                    columns={STRATS_TRANSACTION_HISTORY_TABLE_COLUMN}
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
