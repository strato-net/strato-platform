import React, { useState, useEffect } from "react";
import { PageHeader } from '@ant-design/pro-layout'
import { Card, Row, Col } from 'antd';
import { useMatch } from "react-router-dom";
import { actions } from "../../contexts/subCategory/actions";
import DataTableComponent from "../DataTableComponent";
import { useSubCategoryDispatch, useSubCategoryState } from "../../contexts/subCategory";
import routes from "../../helpers/routes";


const SubCategoryDetails = ({ users }) => {
  const [Id, setId] = useState(undefined);

  const dispatch = useSubCategoryDispatch();

  const { 
    subCategoryDetails,
    issubCategoryDetailsLoading,
    subCategorysAudit,
    issubCategoryAuditLoading
  } = useSubCategoryState();

  const routeMatch = useMatch({
    path: routes.SubCategoryDetail.url,
    strict: true,
  });


  useEffect(() => {
    setId(routeMatch?.params?.id);
  }, [routeMatch]);

  useEffect(() => {
    if (Id !== undefined) {
      actions.fetchSubCategoryDetails(dispatch, Id);
      actions.fetchSubCategoryAudit(dispatch, Id);
    }
  }, [Id, dispatch]);

  const details = subCategoryDetails;
  const audits = subCategorysAudit;
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
      title: "name",
      dataIndex: "name",
    },
    {
      title: "description",
      dataIndex: "description",
    },
    {
      title: "category",
      dataIndex: "category",
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
  if (Id !== undefined && !issubCategoryDetailsLoading && details !== null) {
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
        issubCategoryDetailsLoading ||
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
              <p> category: </p>
            </Col>
            <Col span={4}> 
              <p> {details['category']} </p> 
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
        issubCategoryAuditLoading ?
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

export default SubCategoryDetails;
