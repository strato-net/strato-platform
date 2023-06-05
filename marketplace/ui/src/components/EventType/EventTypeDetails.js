import React, { useState, useEffect, useMemo } from "react";
import { PageHeader } from '@ant-design/pro-layout'
import { Card, Row, Col } from 'antd';
import { useMatch, useLocation } from "react-router-dom";
import { actions } from "../../contexts/eventType/actions";
import DataTableComponent from "../DataTableComponent";
import { useEventTypeDispatch, useEventTypeState } from "../../contexts/eventType";
import routes from "../../helpers/routes";

function useQuery() {
  const { search } = useLocation();

  return useMemo(() => new URLSearchParams(search), [search]);
}

const EventTypeDetails = ({ user, users }) => {
  const [Id, setId] = useState(undefined);
  const [chainId, setChainId] = useState(undefined);

  const dispatch = useEventTypeDispatch();

  const { 
    eventTypeDetails,
    iseventTypeDetailsLoading,
    eventTypesAudit,
    iseventTypeAuditLoading
  } = useEventTypeState();

  const routeMatch = useMatch({
    path: routes.EventTypeDetail.url,
    strict: true,
  });

  const query = useQuery();

  useEffect(() => {
    setId(routeMatch?.params?.id);
    setChainId(query.get("chainId"));
  }, [routeMatch]);

  useEffect(() => {
    if (Id !== undefined && chainId !== undefined) {
      actions.fetchEventTypeDetails(dispatch, Id, chainId);
      actions.fetchEventTypeAudit(dispatch, Id, chainId);
    }
  }, [Id, dispatch]);

  const details = eventTypeDetails;
  const audits = eventTypesAudit;
  if (audits && audits.length) {
    audits.map((val) => {
      if (users && users.length) {
        const sender = users.find((data) => val['transaction_sender'] === data.userAdress);
        audits['sender'] = sender;
      }
    })
  }
  const columns = [
    {
      title: 'Date',
      dataIndex: 'block_timestamp',
    },
    {
      title: 'Sender',
      dataIndex: 'sender',
    },
    {
      title: "name",
      dataIndex: "name",
    },
    {
      title: "description",
      dataIndex: "description",
    },
    {
      title: "createdAt",
      dataIndex: "createdAt",
    },
    {
      title: 'Organization',
      dataIndex: 'ownerOrganization',
    },
    {
      title: 'Organizational Unit',
      dataIndex: 'ownerOrganizationalUnit',
    },
    {
      title: 'Common Name',
      dataIndex: 'ownerCommonName',
    },
  ];
  if (Id !== undefined && !iseventTypeDetailsLoading && details !== null) {
    if (details['ownerOrganizationalUnit'] == '') {
      details['ownerOrganizationalUnit'] = 'N/A'
    }
  }

  return (
    <>
      <PageHeader
      onBack={() => {window.history.back()}}
      title="Details"
      />
        { 
        Id === undefined ||
        iseventTypeDetailsLoading ||
        details === null ?
        <Card />
        : 
        <Card>
          <Row gutter={30} style={{ marginBottom: 10 }}>
            <Col span={4} style={{ textAlign: 'right' }}>
              <p> name: </p>
            </Col>
            <Col span={4}> 
              <p> {details['name']} </p> 
            </Col>
          </Row>
          <Row gutter={30} style={{ marginBottom: 10 }}>
            <Col span={4} style={{ textAlign: 'right' }}>
              <p> description: </p>
            </Col>
            <Col span={4}> 
              <p> {details['description']} </p> 
            </Col>
          </Row>
          <Row gutter={30} style={{ marginBottom: 10 }}>
            <Col span={4} style={{ textAlign: 'right' }}>
              <p> createdAt: </p>
            </Col>
            <Col span={4}> 
              <p> {details['createdAt']} </p> 
            </Col>
          </Row>
          <Row gutter={30} style={{ marginBottom: 10 }}>
            <Col span={4} style={{ textAlign: 'right' }}>
              <p>  Organization: </p>
            </Col>
            <Col span={4}> 
              <p> {details['ownerOrganization']} </p> 
            </Col>
          </Row>
          <Row gutter={30} style={{ marginBottom: 10 }}>
            <Col span={4} style={{ textAlign: 'right' }}>
              <p> Organizational Unit: </p>
            </Col>
            <Col span={4}> 
              <p> {details['ownerOrganizationalUnit']} </p> 
            </Col>
          </Row>
          <Row gutter={30} style={{ marginBottom: 10 }}>
            <Col span={4} style={{ textAlign: 'right' }}>
              <p> Common Name: </p>
            </Col>
            <Col span={4}> 
              <p> {details['ownerCommonName']} </p> 
            </Col>
          </Row>
        </Card>
        }
        <PageHeader title='Audit' />
        { 
        iseventTypeAuditLoading ?
        <Card />
        : 
        <DataTableComponent
          columns={columns}
          data={audits}
          isLoading={false}
        />
        }
    </>
  );
};

export default EventTypeDetails;
