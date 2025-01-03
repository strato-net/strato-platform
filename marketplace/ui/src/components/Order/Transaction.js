import { Breadcrumb, notification } from 'antd';
import React, { useEffect, useState } from 'react';
import routes from '../../helpers/routes';
import ClickableCell from '../ClickableCell';
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { actions as categoryActions } from '../../contexts/category/actions';
import { useCategoryState, useCategoryDispatch } from '../../contexts/category';
import startCase from 'lodash/startCase';
import { epochToDate, getStringDate, groupBy } from '../../helpers/utils';
import {
  REDEMPTION_STATUS,
  TRANSACTION_STATUS,
  US_DATE_FORMAT,
} from '../../helpers/constants';
import TransactionTable from './TransactionTable';
import { useTransactionState } from '../../contexts/transaction';
import { actions as marketplaceActions } from '../../contexts/marketplace/actions';
import { actions as ethAcions } from '../../contexts/eth/actions';
import { useEthDispatch } from '../../contexts/eth';
import { useMarketplaceDispatch } from '../../contexts/marketplace';

const Transaction = ({ user }) => {
  const categoryDispatch = useCategoryDispatch();
  const marketplaceDispatch = useMarketplaceDispatch();
  const ethDispatch = useEthDispatch();
  const [stratAddress, setStratAddress] = useState('');
  const [assetsWithEighteenDecimalPlaces, setAssetsWithEighteenDecimalPlaces] =
    useState('');

  useEffect(() => {
    const fetchAddresses = async () => {
      const assetsWithEighteenDecimalPlaces =
        await marketplaceActions.fetchAssetsWithEighteenDecimalPlaces(
          marketplaceDispatch
        );
      await ethAcions.fetchETHSTAddress(ethDispatch);
      const stratAddress = await marketplaceActions.fetchStratsAddress(
        marketplaceDispatch
      );
      setAssetsWithEighteenDecimalPlaces(assetsWithEighteenDecimalPlaces);
      setStratAddress(stratAddress);
    };

    fetchAddresses();
  }, []);

  const { userTransactions, isTransactionLoading } = useTransactionState();
  const [callExcel, setCallExcel] = useState(false);
  const [callCSV, setCallCSV] = useState(false);
  const { categorys } = useCategoryState();
  const [api, contextHolder] = notification.useNotification();

  useEffect(() => {
    categoryActions.fetchCategories(categoryDispatch);
  }, [categoryDispatch]);

  // --------------------- EXPORT TO EXCEL AND CSV START ---------------------
  function getCategoryAndSubcategory(contractName) {
    for (const category of categorys) {
      for (const subCategory of category.subCategories) {
        // endsWith is used to match the contract name with the subcategory contract
        if (contractName?.endsWith(subCategory.contract)) {
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

  function mapTransactionData(transactions) {
    try {
      return transactions.map((transaction) => {
        const { category, subCategory } = getCategoryAndSubcategory(
          transaction.assetContractName
        );
        let isStrat = transaction.assetOriginAddress === stratAddress;
        let is18DecimalPlaces = assetsWithEighteenDecimalPlaces.includes(
          transaction.assetOriginAddress
        );
        return formatDataObject({
          reference: transaction?.reference,
          type: transaction?.type,
          category,
          subCategory,
          assetName: transaction?.assetName,
          Price: isStrat
            ? Number((transaction?.price * 100).toFixed(2))
            : is18DecimalPlaces
            ? Number((transaction?.price * Math.pow(10, 18)).toFixed(2))
            : transaction?.price,
          quantity: isStrat
            ? (transaction?.quantity / 100).toString()
            : is18DecimalPlaces
            ? (transaction?.quantity / Math.pow(10, 18)).toString()
            : transaction?.quantity.toString(),
          from: transaction.from,
          to: transaction.to,
          hash: transaction.transaction_hash,
          date: getStringDate(transaction?.createdDate, US_DATE_FORMAT),
          Status:
            transaction?.type === 'Transfer'
              ? 'Closed'
              : transaction?.type === 'Redemption'
              ? REDEMPTION_STATUS[transaction.status]
              : transaction?.type === 'Stake'
              ? 'Staked'
              : transaction?.type === 'Unstake'
              ? 'Unstaked'
              : TRANSACTION_STATUS[transaction.status],
        });
      });
    } catch (error) {
      console.error('Error during mapping order data', error);
      throw new Error('Failed to map order data');
    }
  }

  useEffect(() => {
    const mappedData = mapTransactionData(userTransactions);
    const { Order, Redemption, Transfer, Stake, Unstake } = groupBy(
      mappedData,
      ({ Type }) => Type
    );
    if (userTransactions && callExcel && !isTransactionLoading) {
      const wb = XLSX.utils.book_new();
      const wsOrder = XLSX.utils.json_to_sheet(Order ? Order : []);
      const wsTransferred = XLSX.utils.json_to_sheet(Transfer ? Transfer : []);
      const wsRedemption = XLSX.utils.json_to_sheet(
        Redemption ? Redemption : []
      );
      const wsStake = XLSX.utils.json_to_sheet(Stake ? Stake : []);
      const wsUnstake = XLSX.utils.json_to_sheet(Unstake ? Unstake : []);

      // Append each worksheet to the workbook
      XLSX.utils.book_append_sheet(wb, wsOrder, 'Order');
      XLSX.utils.book_append_sheet(wb, wsTransferred, 'Transfer');
      XLSX.utils.book_append_sheet(wb, wsRedemption, 'Redemption');
      XLSX.utils.book_append_sheet(wb, wsStake, 'Stake');
      XLSX.utils.book_append_sheet(wb, wsUnstake, 'Unstake');

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
    if (userTransactions && callCSV && !isTransactionLoading) {
      // Adding an extra column to distinguish data
      const addTypeColumn = (data, type) =>
        data.map((row) => ({ ...row, Type: type }));

      const orderData = addTypeColumn(Order ? Order : [], 'Order');
      const transferredData = addTypeColumn(
        Transfer ? Transfer : [],
        'Transfer'
      );
      const redemptionData = addTypeColumn(
        Redemption ? Redemption : [],
        'Redemption'
      );

      const stakeData = addTypeColumn(Stake ? Stake : [], 'Stake');

      const unstakeData = addTypeColumn(Unstake ? Unstake : [], 'Unstake');

      const combinedData = [
        ...orderData,
        ...transferredData,
        ...redemptionData,
        ...stakeData,
        ...unstakeData,
      ];
      const ws = XLSX.utils.json_to_sheet(combinedData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Orders');

      const wbout = XLSX.write(wb, { bookType: 'csv', type: 'binary' });
      const blob = new Blob([s2ab(wbout)], { type: 'text/csv' });
      saveAs(blob, 'Mercata-Marketplace-Order-History.csv');
      setCallCSV(false);
      setCallExcel(false);
    }
  }, [callExcel, callCSV, isTransactionLoading]);

  const download = async (format) => {
    if (user?.commonName) {
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

  // --------------------- EXPORT TO EXCEL AND CSV END ---------------------

  return (
    <div>
      {contextHolder}
      <Breadcrumb className="mx-5 md:mx-14 mt-2 lg:mt-4">
        <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
          <ClickableCell href={routes.Marketplace.url}>
            <p className="text-sm text-[#13188A] font-semibold">Home</p>
          </ClickableCell>
        </Breadcrumb.Item>
        <Breadcrumb.Item href="" onClick={(e) => e.preventDefault()}>
          <p className=" text-sm text-[#202020] font-medium">My Transactions</p>
        </Breadcrumb.Item>
      </Breadcrumb>
      <TransactionTable
        user={user}
        download={download}
        stratAddress={stratAddress}
        assetsWithEighteenDecimalPlaces={assetsWithEighteenDecimalPlaces}
      />
    </div>
  );
};

export default Transaction;
