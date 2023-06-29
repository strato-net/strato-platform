import React, { useState, useEffect } from "react";
import { PageHeader } from '@ant-design/pro-layout'
import { Card, Row, Col } from 'antd';
import { useMatch } from "react-router-dom";
import { actions } from "../../contexts/orderLineItem/actions";
import DataTableComponent from "../DataTableComponent";
import { useOrderLineItemDispatch, useOrderLineItemState } from "../../contexts/orderLineItem";
import routes from "../../helpers/routes";

const OrderLineItemDetails = ({ user, users }) => {
  const [Id, setId] = useState(undefined);

  const dispatch = useOrderLineItemDispatch();

  const { 
    orderLineItemDetails,
    isorderLineItemDetailsLoading,
    orderLineItemsAudit,
    isorderLineItemAuditLoading
  } = useOrderLineItemState();

  const routeMatch = useMatch({
    path: routes.OrderLineItemDetail.url,
    strict: true,
  });


  useEffect(() => {
    setId(routeMatch?.params?.id);
  }, [routeMatch]);

  useEffect(() => {
    if (Id !== undefined) {
      actions.fetchOrderLineItemDetails(dispatch, Id);
      actions.fetchOrderLineItemAudit(dispatch, Id);
    }
  }, [Id, dispatch]);

  const details = orderLineItemDetails;
  const audits = orderLineItemsAudit;
  if (audits && audits.length) {
    audits.forEach((val) => {
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
      title: "orderId",
      dataIndex: "orderId",
    },
    {
      title: "inventoryId",
      dataIndex: "inventoryId",
    },
    {
      title: "productId",
      dataIndex: "productId",
    },
    {
      title: "quantity",
      dataIndex: "quantity",
    },
    {
      title: "pricePerUnit",
      dataIndex: "pricePerUnit",
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
  if (Id !== undefined && !isorderLineItemDetailsLoading && details !== null) {
    if (details['ownerOrganizationalUnit'] === '') {
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
        isorderLineItemDetailsLoading ||
        details === null ?
        <Card />
        : 
        <Card>
          <Row gutter={30} style={{ marginBottom: 10 }}>
            <Col span={4} style={{ textAlign: 'right' }}>
              <p> orderId: </p>
            </Col>
            <Col span={4}> 
              <p> {details['orderId']} </p> 
            </Col>
          </Row>
          <Row gutter={30} style={{ marginBottom: 10 }}>
            <Col span={4} style={{ textAlign: 'right' }}>
              <p> inventoryId: </p>
            </Col>
            <Col span={4}> 
              <p> {details['inventoryId']} </p> 
            </Col>
          </Row>
          <Row gutter={30} style={{ marginBottom: 10 }}>
            <Col span={4} style={{ textAlign: 'right' }}>
              <p> productId: </p>
            </Col>
            <Col span={4}> 
              <p> {details['productId']} </p> 
            </Col>
          </Row>
          <Row gutter={30} style={{ marginBottom: 10 }}>
            <Col span={4} style={{ textAlign: 'right' }}>
              <p> quantity: </p>
            </Col>
            <Col span={4}> 
              <p> {details['quantity']} </p> 
            </Col>
          </Row>
          <Row gutter={30} style={{ marginBottom: 10 }}>
            <Col span={4} style={{ textAlign: 'right' }}>
              <p> pricePerUnit: </p>
            </Col>
            <Col span={4}> 
              <p> {details['pricePerUnit']} </p> 
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
        isorderLineItemAuditLoading ?
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

export default OrderLineItemDetails;
