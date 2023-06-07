import React, { useState, useEffect } from "react";
import { PageHeader } from '@ant-design/pro-layout'
import { Card, Row, Col } from 'antd';
import { useMatch } from "react-router-dom";
import { actions } from "../../contexts/item/actions";
import DataTableComponent from "../DataTableComponent";
import { useItemDispatch, useItemState } from "../../contexts/item";
import routes from "../../helpers/routes";


const ItemDetails = ({ user, users }) => {
  const [Id, setId] = useState(undefined);

  const dispatch = useItemDispatch();

  const { 
    itemDetails,
    isitemDetailsLoading,
    itemsAudit,
    isitemAuditLoading
  } = useItemState();

  const routeMatch = useMatch({
    path: routes.ItemDetail.url,
    strict: true,
  });

  useEffect(() => {
    setId(routeMatch?.params?.id);
  }, [routeMatch]);

  useEffect(() => {
    if (Id !== undefined) {
      actions.fetchItemDetails(dispatch, Id);
      actions.fetchItemAudit(dispatch, Id);
    }
  }, [Id, dispatch]);

  const details = itemDetails;
  const audits = itemsAudit;
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
      title: "productId",
      dataIndex: "productId",
    },
    {
      title: "inventoryId",
      dataIndex: "inventoryId",
    },
    {
      title: "serialNumber",
      dataIndex: "serialNumber",
    },
    {
      title: "status",
      dataIndex: "status",
    },
    {
      title: "comment",
      dataIndex: "comment",
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
  if (Id !== undefined && !isitemDetailsLoading && details !== null) {
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
        isitemDetailsLoading ||
        details === null ?
        <Card />
        : 
        <Card>
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
              <p> inventoryId: </p>
            </Col>
            <Col span={4}> 
              <p> {details['inventoryId']} </p> 
            </Col>
          </Row>
          <Row gutter={30} style={{ marginBottom: 10 }}>
            <Col span={4} style={{ textAlign: 'right' }}>
              <p> serialNumber: </p>
            </Col>
            <Col span={4}> 
              <p> {details['serialNumber']} </p> 
            </Col>
          </Row>
          <Row gutter={30} style={{ marginBottom: 10 }}>
            <Col span={4} style={{ textAlign: 'right' }}>
              <p> status: </p>
            </Col>
            <Col span={4}> 
              <p> {details['status']} </p> 
            </Col>
          </Row>
          <Row gutter={30} style={{ marginBottom: 10 }}>
            <Col span={4} style={{ textAlign: 'right' }}>
              <p> comment: </p>
            </Col>
            <Col span={4}> 
              <p> {details['comment']} </p> 
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
        isitemAuditLoading ?
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

export default ItemDetails;
