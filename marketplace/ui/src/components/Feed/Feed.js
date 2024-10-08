import { Breadcrumb, notification } from "antd";
import React, { useEffect, useState } from "react";
import routes from "../../helpers/routes";
import ClickableCell from "../ClickableCell";
import * as XLSX from 'xlsx';
import { saveAs } from 'file-saver';
import { actions as categoryActions } from "../../contexts/category/actions";
import { useCategoryState, useCategoryDispatch } from "../../contexts/category";
import startCase from 'lodash/startCase';
import { epochToDate, getStringDate, groupBy } from "../../helpers/utils";
import { REDEMPTION_STATUS, TRANSACTION_STATUS, US_DATE_FORMAT } from "../../helpers/constants";
import { useTransactionState } from "../../contexts/transaction";
import GlobalTransaction from "./GlobalTransaction";

const Feed = ({ user }) => {
  const categoryDispatch = useCategoryDispatch();

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
        if (contractName.endsWith(subCategory.contract)) {
          return { category: category.name, subCategory: subCategory.name };
        }
      }
    }
    return { category: 'Unknown', subCategory: 'Unknown' };
  }

  function formatDataObject(dataObject) {
    let formattedObject = {};
    Object.keys(dataObject).forEach(key => {
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


  return (
    <div>
      {contextHolder}
      <div className="px-4 md:px-10 lg:py-2 lg:mt-3 orders">
        <Breadcrumb>
          <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
            <ClickableCell href={routes.Marketplace.url}>
              <p className="text-sm text-[#13188A] font-semibold">
                Home
              </p>
            </ClickableCell>
          </Breadcrumb.Item>
          <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
            <p className=" text-sm text-[#202020] font-medium">
              Feeds
            </p>
          </Breadcrumb.Item>
        </Breadcrumb>
      </div>
      <GlobalTransaction user={user} isAllOrdersLoading={isTransactionLoading} />
    </div>
  );
};

export default Feed;
