import React from 'react';
import { Breadcrumb } from "antd";
import { Link, useLocation, useParams } from 'react-router-dom';
import ClickableCell from '../ClickableCell';
import { BREADCRUMB_ROUTES, BREADCRUMB_VALUES } from '../../helpers/constants';
import routes from '../../helpers/routes';

const BreadcrumbComponent = ({ indexNo, idNum }) => {
  const location = useLocation();
  const params = useParams();
  const { type } = params;
  const pathSnippets = location.pathname.split('/').filter(i => i);
  const isLastIndex = index => index === pathSnippets.length - 1;

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

        if (index === indexNo) return null;
        if (indexNo && snippet === 'order') {
          return <p key={index} className="text-sm text-[#202020] font-semibold capitalize">
            {`${snippet}s (${BREADCRUMB_VALUES[type]})`}
          </p>
        }
        if (idNum && isLastIndex(index)) {
          return <Breadcrumb.Item key={index}> <p className="text-sm text-[#202020] font-medium ">
            {idNum}
          </p></Breadcrumb.Item>
        }
        return (
          <React.Fragment key={index}>
            {snippet === 'inventories' && index === 0 && (
              <Breadcrumb.Item href="/myitems">
                <ClickableCell href="" onClick={e => e.preventDefault()}>
                  <p className="text-sm text-[#13188A] font-semibold">
                    My Items
                  </p>
                </ClickableCell>
              </Breadcrumb.Item>
            )}
            <Breadcrumb.Item href={isLastIndex(index) ? undefined : BREADCRUMB_ROUTES[snippet]}>
              {isLastIndex(index) ? (
                <p className="text-sm text-[#202020] font-semibold">
                  {BREADCRUMB_VALUES[snippet] || decodeURIComponent(snippet)}
                </p>
              ) : (
                <ClickableCell >
                  <p className="text-sm text-[#13188A] font-semibold">
                    {BREADCRUMB_VALUES[snippet] || decodeURIComponent(snippet)}
                  </p>
                </ClickableCell>
              )}
            </Breadcrumb.Item>
          </React.Fragment>
        );
      })}
    </Breadcrumb>
  );
}

export default BreadcrumbComponent;
