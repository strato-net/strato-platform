import React from 'react';
import { Breadcrumb } from "antd";
import { Link, useLocation, useParams } from 'react-router-dom';
import ClickableCell from '../ClickableCell';
import { BREADCRUMB_ROUTES, BreadCrumb_VALUES } from '../../helpers/constants';
import routes from '../../helpers/routes';

const BreadcrumbComponent = ({ indexNo, number }) => {
  const location = useLocation();
  const params = useParams();
  const { type } = params;
  const pathSnippets = location.pathname.split('/').filter(i => i);
  return (
    <Breadcrumb className="mx-5 md:mx-14 mt-2 lg:mt-4">
      <Breadcrumb.Item href="" onClick={e => e.preventDefault()}>
        <ClickableCell href={routes.Marketplace.url}>
          <p className="text-sm text-[#13188A] font-semibold">
            Home
          </p>
        </ClickableCell>
      </Breadcrumb.Item>
      {pathSnippets?.map((snippet, index) => {
        const url = `/${pathSnippets.slice(0, index + 1).join('/')}`;

        if (index === indexNo) return null;
        if (indexNo && snippet === 'order') {
          return <p className="text-sm text-[#202020] font-semibold capitalize">
            {`${snippet}s (${BreadCrumb_VALUES[type]})`}
          </p>
        }
        if (number && pathSnippets.length - 1 === index) {
          return <Breadcrumb.Item href=''> <p className="text-sm text-[#202020] font-medium ">
            {number}
          </p></Breadcrumb.Item>
        }
        return <>
          {snippet === 'inventories' && index === 0 && <Breadcrumb.Item href=''>
            <ClickableCell href={""} onClick={e => e.preventDefault()} >
              <p className="text-sm text-[#13188A] font-semibold">
                My Items
              </p>
            </ClickableCell>
          </Breadcrumb.Item>}
          <Breadcrumb.Item href={`${BREADCRUMB_ROUTES[snippet]}`}>
            {pathSnippets.length === index - 1 ?
              <ClickableCell href={`/${snippet}`}>
                <p className="text-sm text-[#13188A] font-semibold">
                  {BreadCrumb_VALUES[snippet] || decodeURIComponent(snippet)}
                </p>
              </ClickableCell>
              : <p className="text-sm text-[#202020] font-semibold">
                {BreadCrumb_VALUES[snippet] || decodeURIComponent(snippet)}
              </p>}
          </Breadcrumb.Item>
        </>
      })}
    </Breadcrumb>
  );
}

export default BreadcrumbComponent;
