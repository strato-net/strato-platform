import {
  Tabs,
  DatePicker,
  Breadcrumb,
  Button,
  Dropdown,
  Space,
  notification,
} from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import SoldOrdersTable from './SoldOrdersTable';
import BoughtOrdersTable from './BoughtOrdersTable';
import TransfersTable from './TransfersTable';
import RedemptionsOutgoingTable from './RedemptionsOutgoingTable';
import RedemptionsIncomingTable from './RedemptionsIncomingTable';
import dayjs from 'dayjs';
import routes from '../../helpers/routes';
import ClickableCell from '../ClickableCell';
import { Images } from '../../images';
import { saveAs } from 'file-saver';
import * as XLSX from 'xlsx';
import { actions } from '../../contexts/order/actions';
import { useOrderDispatch, useOrderState } from '../../contexts/order';
import { actions as categoryActions } from '../../contexts/category/actions';
import { useCategoryState, useCategoryDispatch } from '../../contexts/category';
import startCase from 'lodash/startCase';
import { epochToDate } from '../../helpers/utils';
import { ORDER_STATUS } from '../../helpers/constants';
const INVERTED_ORDER_STATUS = Object.fromEntries(
  Object.entries(ORDER_STATUS).map(([key, value]) => [value, key])
);

const Order = ({ user }) => {
  const navigate = useNavigate();
  const params = useParams();
  const { type } = params;
  const dispatch = useOrderDispatch();
  const categoryDispatch = useCategoryDispatch();
  const [callExcel, setCallExcel] = useState(false);
  const [callCSV, setCallCSV] = useState(false);
  const { allOrders, isAllOrdersLoading } = useOrderState();
  const { categorys } = useCategoryState();
  const [api, contextHolder] = notification.useNotification();
  useEffect(() => {
    categoryActions.fetchCategories(categoryDispatch);
  }, [categoryDispatch]);

  const onChange = (key) => {
    navigate(`/order/${key}`);
  };

  const [selectedDate, setSelectedDate] = useState('');

  const onDateChange = (date) => {
    setSelectedDate(date);
  };

  // --------------------- EXPORT TO EXCEL AND CSV START ---------------------
  function getCategoryAndSubcategory(contractName) {
    for (const category of categorys) {
      for (const subCategory of category.subCategories) {
        // endsWith is used to match the contract name with the subcategory contract
        if (contractName.endsWith(subCategory.contract)) {
          return { category: category.name, subCategory: subCategory.name };
        }
      }
    }
    return { category: 'Unknown', subCategory: 'Unknown' };
  }

  function formatDataObject(dataObject) {
    let formattedObject = {};
    Object.keys(dataObject).forEach((key) => {
      let value = dataObject[key];
      if (key.endsWith('Date')) {
        value = epochToDate(value);
      } else if (key === 'comments') {
        value = decodeURIComponent(value);
      }

      if (key === 'assetPrice') {
        formattedObject['Asset Price (Unit)'] = value;
      } else {
        formattedObject[startCase(key)] = value;
      }
    });
    return formattedObject;
  }

  function mapOrderData(orders) {
    try {
      return orders.flatMap((order) => {
        // Extract Quantities
        let orderQuantities;
        if (order['BlockApps-Mercata-Order-quantities']?.length) {
          orderQuantities = order['BlockApps-Mercata-Order-quantities'].map(
            (item) => item.value
          );
        } else if (order.quantities?.length) {
          orderQuantities = order.quantities[0];
        } else {
          orderQuantities = [0];
        }

        return order.assets.map((asset, index) => {
          const { category, subCategory } = getCategoryAndSubcategory(
            asset.contract_name
          );

          return formatDataObject({
            orderNumber: order.orderId,
            purchaserName: order.purchasersCommonName,
            category,
            subCategory,
            assetName: asset.name,
            assetPrice: asset.salePrice,
            quantity: orderQuantities[index],
            totalOrderAmount: order.totalPrice,
            orderDate: order.createdDate,
            orderFulfillmentDate: order.fulfillmentDate,
            orderStatus: INVERTED_ORDER_STATUS[order.status] || 'Unknown',
            comments: order.comments,
            blockchainAddress: order.address,
          });
        });
      });
    } catch (error) {
      // logging the actual error for better debugging
      console.error('Error during mapping order data:', error);
      throw new Error('Failed to map order data');
    }
  }

  function mapTransfersData(transfers) {
    try {
      return transfers.map((order) => {
        const { category, subCategory } = getCategoryAndSubcategory(
          order.contract_name
        );
        return formatDataObject({
          transferNumber: order.id,
          transferDate: order.transferDate,
          category,
          subCategory,
          assetName: order.assetName,
          quantity: order.quantity,
          sender: order.oldOwnerCommonName,
          recipient: order.newOwnerCommonName,
          blockchainAddress: order.address,
        });
      });
    } catch (error) {
      throw new Error('Failed to map transfers data');
    }
  }

  useEffect(() => {
    if (allOrders && callExcel && !isAllOrdersLoading) {
      const wb = XLSX.utils.book_new();
      let sold;
      let bought;
      let transferred;
      try {
        sold = mapOrderData(allOrders.bodySold);
      } catch (error) {
        api.error({
          message: 'Data Processing Error',
          description: 'Failed to process order data. Please contact support.',
          placement: 'bottom',
        });
        return;
      }
      const wsSold = XLSX.utils.json_to_sheet(sold ? sold : []);
      try {
        bought = mapOrderData(allOrders.bodyBought);
      } catch (error) {
        api.error({
          message: 'Data Processing Error',
          description: 'Failed to process order data. Please contact support.',
          placement: 'bottom',
        });
        return;
      }
      const wsBought = XLSX.utils.json_to_sheet(bought ? bought : []);
      try {
        transferred = mapTransfersData(allOrders.bodyTransfers);
      } catch (error) {
        api.error({
          message: 'Data Processing Error',
          description: 'Failed to process order data. Please contact support.',
          placement: 'bottom',
        });
        return;
      }
      const wsTransferred = XLSX.utils.json_to_sheet(
        transferred ? transferred : []
      );

      // Append each worksheet to the workbook
      XLSX.utils.book_append_sheet(wb, wsSold, 'Sold Orders');
      XLSX.utils.book_append_sheet(wb, wsBought, 'Bought Orders');
      XLSX.utils.book_append_sheet(wb, wsTransferred, 'Transfers');

      // Write the workbook to a binary string
      const wbout = XLSX.write(wb, { bookType: 'xls', type: 'binary' });

      // Convert the binary string to a Blob and save it
      const blob = new Blob([s2ab(wbout)], {
        type: 'application/vnd.ms-excel',
      });
      saveAs(blob, 'Mercata-Marketplace-Order-History.xls');
      setCallExcel(false);
      setCallCSV(false);
    }
    if (allOrders && callCSV && !isAllOrdersLoading) {
      // Adding an extra column to distinguish data
      const addTypeColumn = (data, type) =>
        data.map((row) => ({ ...row, Type: type }));
      let sold;
      let bought;
      let transferred;
      try {
        sold = mapOrderData(allOrders.bodySold);
      } catch (error) {
        api.error({
          message: 'Data Processing Error',
          description: 'Failed to process order data. Please contact support.',
          placement: 'bottom',
        });
        return;
      }
      try {
        bought = mapOrderData(allOrders.bodyBought);
      } catch (error) {
        api.error({
          message: 'Data Processing Error',
          description: 'Failed to process order data. Please contact support.',
          placement: 'bottom',
        });
        return;
      }
      try {
        transferred = mapTransfersData(allOrders.bodyTransfers);
      } catch (error) {
        api.error({
          message: 'Data Processing Error',
          description: 'Failed to process order data. Please contact support.',
          placement: 'bottom',
        });
        return;
      }
      const soldData = addTypeColumn(sold ? sold : [], 'Sold');
      const boughtData = addTypeColumn(bought ? bought : [], 'Bought');
      const transferredData = addTypeColumn(
        transferred ? transferred : [],
        'Transferred'
      );

      const combinedData = [...soldData, ...boughtData, ...transferredData];
      const ws = XLSX.utils.json_to_sheet(combinedData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Orders');

      const wbout = XLSX.write(wb, { bookType: 'csv', type: 'binary' });
      const blob = new Blob([s2ab(wbout)], { type: 'text/csv' });
      saveAs(blob, 'Mercata-Marketplace-Order-History.csv');
      setCallCSV(false);
      setCallExcel(false);
    }
  }, [allOrders, callExcel, callCSV, isAllOrdersLoading]);

  const download = async (format) => {
    if (user?.commonName) {
      await actions.fetchAllOrders(dispatch);
      if (format === 'xls') {
        setCallExcel(true);
        setCallCSV(false);
      } else if (format === 'csv') {
        setCallCSV(true);
        setCallExcel(false);
      }
    }
  };

  // Utility function to convert a binary string to an ArrayBuffer
  function s2ab(s) {
    const buf = new ArrayBuffer(s.length);
    const view = new Uint8Array(buf);
    for (let i = 0; i < s.length; i++) view[i] = s.charCodeAt(i) & 0xff;
    return buf;
  }

  const menuItems = [
    {
      key: 'xls',
      label: 'Excel',
      disabled: isAllOrdersLoading,
    },
    {
      key: 'csv',
      label: 'CSV',
      disabled: isAllOrdersLoading,
    },
  ];
  // --------------------- EXPORT TO EXCEL AND CSV END ---------------------

  return (
    <div>
      {contextHolder}
      <div className="px-4 md:px-20 lg:py-2 lg:mt-3 orders">
        <Breadcrumb>
          <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
            <ClickableCell href={routes.Marketplace.url}>
              <p className="text-sm text-[#13188A] font-semibold">Home</p>
            </ClickableCell>
          </Breadcrumb.Item>
          <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
            <p className=" text-sm text-[#202020] font-medium">
              {'Orders (' + type + ')'}
            </p>
          </Breadcrumb.Item>
        </Breadcrumb>
      </div>
      <Tabs
        className="mx-4 md:mx-20 lg:mt-[10px]"
        key={type}
        defaultActiveKey={type}
        onChange={onChange}
        tabBarExtraContent={
          <div className="text-xs md:flex items-center orders_page">
            <Dropdown
              className="md:flex hidden customButton"
              menu={{ items: menuItems, onClick: (e) => download(e.key) }}
              disabled={isAllOrdersLoading}
              trigger={['click']}
            >
              <Button loading={isAllOrdersLoading}>
                <Space>
                  <DownloadOutlined />
                </Space>
              </Button>
            </Dropdown>

            <DatePicker
              className="md:flex hidden"
              style={{ backgroundColor: '#F6F6F6' }}
              value={selectedDate}
              disabledDate={(current) => {
                const currentDate = dayjs().startOf('day'); // Get the start of today
                const selectedDate = dayjs(current).startOf('day');

                return selectedDate.isAfter(currentDate);
              }}
              onChange={onDateChange}
              disabled={false}
              suffixIcon={
                <img
                  src={Images.calender}
                  alt="calender"
                  className=" w-[18px] h-5"
                  style={{ maxWidth: 'none' }}
                />
              }
            />
          </div>
        }
        items={[
          {
            label: (
              <p id="sold-tab" className="font-semibold text-sm md:text-base">
                Orders (Sold)
              </p>
            ),
            key: 'sold',
            children: (
              <SoldOrdersTable
                user={user}
                selectedDate={dayjs(selectedDate).startOf('day').unix()}
                onDateChange={onDateChange}
                download={download}
                isAllOrdersLoading={isAllOrdersLoading}
              />
            ),
          },
          {
            label: (
              <p id="bought-tab" className="font-semibold text-sm md:text-base">
                Orders (Bought)
              </p>
            ),
            key: 'bought',
            children: (
              <BoughtOrdersTable
                user={user}
                selectedDate={dayjs(selectedDate).startOf('day').unix()}
                onDateChange={onDateChange}
                download={download}
                isAllOrdersLoading={isAllOrdersLoading}
              />
            ),
          },
          {
            label: (
              <p
                id="transfers-tab"
                className="font-semibold text-sm md:text-base"
              >
                Transfers
              </p>
            ),
            key: 'transfers',
            children: (
              <TransfersTable
                user={user}
                selectedDate={dayjs(selectedDate).startOf('day').unix()}
                download={download}
                isAllOrdersLoading={isAllOrdersLoading}
              />
            ),
          },
          {
            label: (
              <p
                id="redemptions-outgoing-tab"
                className="font-semibold text-sm md:text-base"
              >
                Redemptions (Outgoing)
              </p>
            ),
            key: 'redemptions-outgoing',
            children: (
              <RedemptionsOutgoingTable
                user={user}
                selectedDate={dayjs(selectedDate).startOf('day').unix()}
                download={download}
                isAllOrdersLoading={isAllOrdersLoading}
              />
            ),
          },
          {
            label: (
              <p
                id="redemptions-incoming-tab"
                className="font-semibold text-sm md:text-base"
              >
                Redemptions (Incoming)
              </p>
            ),
            key: 'redemptions-incoming',
            children: (
              <RedemptionsIncomingTable
                user={user}
                selectedDate={dayjs(selectedDate).startOf('day').unix()}
                download={download}
                isAllOrdersLoading={isAllOrdersLoading}
              />
            ),
          },
        ]}
      />
    </div>
  );
};

export default Order;
