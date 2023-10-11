import React, { useEffect, useState } from "react";
import { useFormik, getIn } from "formik";
import { Card, Popover, Spin, Button, Row, Col, Typography, Image, Modal, Table, Collapse } from "antd";
import { MoreOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
// import DeleteProductModal from "./DeleteProductModal";
// import UpdateProductModal from "./UpdateProductModal";
import "./membership.css";
import routes from "../../helpers/routes";
import { useNavigate } from "react-router-dom";
import { useAuthenticateState } from "../../contexts/authentication";
import ListNowModal from "../Membership/ListNowModal";
import * as yup from "yup";
import { actions as membershipActions } from "../../contexts/membership/actions";
import { actions as inventoryActions } from "../../contexts/inventory/actions";
import { useMembershipDispatch } from "../../contexts/membership";
import { Carousel } from 'react-responsive-carousel';
import { tag, tagIcon } from "../../images/SVGComponents";

import { INVENTORY_STATUS } from "../../helpers/constants";
import { useInventoryDispatch, useInventoryState } from "../../contexts/inventory";
import 'react-responsive-carousel/lib/styles/carousel.min.css';


const { Text, Paragraph, Title } = Typography;

const statusText = {
  1: 'For Sale',
  2: 'Not For Sale'
}

const columns = [

  {
    title: 'Date',
    dataIndex: 'name',
    key: 'name',
    width: '20%',
    color: "red",
    // ...getColumnSearchProps('name'),
  },
  {
    title: 'Quantity',
    dataIndex: 'age',
    key: 'age',
    width: '15%',
    // ...getColumnSearchProps('age'),
  },
  {
    title: 'Published/Unpublished',
    dataIndex: 'published',
    key: 'published',
    width: '30%',
    // ...getColumnSearchProps('age'),
  },
  {
    title: 'Price',
    dataIndex: 'address',
    key: 'address',
    width: '20%',
    // ...getColumnSearchProps('address'),
    sorter: (a, b) => a.address.length - b.address.length,
    sortDirections: ['descend', 'ascend'],
  },
  {
    title: '',
    dataIndex: 'preview',
    key: 'preview',
    width: '7%',
  }
];

const initialValues = {
  name: "",
  price: "",
  quantity: ""
};


const MembershipCardPurchased = ({
  user,
  membership,
  categorys,
  debouncedSearchTerm,
  membershipId,
  isPurchasedList
}) => {
  const membershipDispatch = useMembershipDispatch();
  const {
    subCategory,
    manufacturer,
    timePeriodInMonths,
    savings,
    // membershipId,
    membershipAddress,
    inventoryId,
    Inventories,
    status
  } = membership;

  const [state, setState] = useState(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const [carouselModel, setCarouselModel] = useState(false);
  const navigate = useNavigate();
  const naviroute = routes.MembershipDetail.url;
  const [visible, setVisible] = useState(false);

  const getSchema = (isListNowModalOpen) => {
    return yup.object().shape({
      name: yup.string().required("Membership name is required"),
      price: yup.number().when("isListNowModalOpen", {
        is: () => isListNowModalOpen, // Use a function to evaluate the condition
        then: yup.number().required("Price is required"),
      }),
      quantity: yup.number().when("isListNowModalOpen", {
        is: () => isListNowModalOpen, // Use a function to evaluate the condition
        then: yup.number(),
      }),
    });
  };


  const formik = useFormik({
    initialValues: initialValues,
    validationSchema: getSchema(visible),
    setFieldValue: (field, value) => {
      formik.setFieldValue(field, value);
    },
    onSubmit: function (values) {
      handleCreateFormSubmit(values);
    },
    enableReinitialize: true,
  });


  const updateCol = (inv, texts) => (<Row
    style={{ justifyContent: 'space-between' }}>
    <p>{texts} </p>
    <EditOutlined onClick={() => {
      if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
        window.location.href = loginUrl;
      } else {
        formik.setFieldValue("name", membership.product.name);
        formik.setFieldValue("tempInv", inv);
        openListNowModal();
      }
    }} />
  </Row>)

  const callDetailPage = (index, address) => {
    navigate(`${naviroute.replace(":id", address)}`, { state: { isCalledFromMembership: true, inventoryId: address ?? null } });
  }

  const previewCol = (indx, address) => (<Button type="text"
    className="text-primary text-sm cursor-pointer"
    onClick={callDetailPage.bind(this, indx, address)}
  >
    Preview
  </Button>)


  let data = Inventories?.map((inventory, index) => {
    return {
      key: index,
      name: inventory.block_timestamp,
      age: inventory.availableQuantity,
      published: updateCol(inventory, inventory.status === 1 ? "Published" : "Unpublished"),
      preview: previewCol(index, inventory.address),
      address: "$ " + String(inventory.pricePerUnit)
    }
  });

  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
  const { isCreateInventorySubmitting, inventories } = useInventoryState();

  useEffect(() => {
    setState(membership);
  }, [membership]);

  const closeListNowModal = () => {
    setVisible(false);
  };

  const openListNowModal = () => {
    setVisible(true);
  };

  const handleCreateFormSubmit = async (values) => {
    if (user) {
      if (formik.values.price !== "" && inventories) {
        const resalePayload = {
          productAddress: membership.productId,
          inventory: membership.inventoryId,
          updates: {
            pricePerUnit: formik.values.price,
            status: INVENTORY_STATUS.PUBLISHED,
            quantity: 1
          }
        }
        const resaleMembership = await membershipActions.resaleMembership(
          membershipDispatch, resalePayload
        )

        if (resaleMembership) {
          // membership.product_with_inventory = 1;
          formik.resetForm();
        }
        setVisible(false);
      }
    }
  };


  return (
    <>
      {state === null ? (
        <div className="h-screen flex justify-center items-center">
          <Spin />
        </div>
      ) : (
        <Card className="w-full mt-6 border-grey" id="product" key={membershipId}>
          <Col span={24}>
            <Row className="p-4 flex justify-between rounded-md" style={{ backgroundColor: "#f2f2f2" }}>
              <Col >
                <Row>
                  <Typography.Title level={4}>
                    {decodeURIComponent(membership.productName)}
                  </Typography.Title>
                </Row>
                <Typography.Text strong type={status == 1 ? 'success' : 'danger'} level={4}>
                  <span style={{
                    borderRadius: '10%', backgroundColor: `${status == 1 ? 'green' : status == 2 ? 'red' : 'green'}`,
                    height: "8px", width: "8px", borderRadius: "20%"
                  }} > &nbsp; &nbsp; &nbsp;</span>
                  {' '}{statusText[status]??"For Sale"}
                </Typography.Text>
              </Col>
              <Col  className="text-right flex" style={{ alignItems: "center" }}>
                <Button className="primary-theme-text font-bold text-lg" type="text" onClick={() => { callDetailPage(null, inventoryId) }}>
                  Preview  &gt;&gt;
                </Button>
              </Col>
            </Row>
            <Row className="mt-4">
              <Col sm={12} lg={12} xl={8} xxl={6} className="border-grey shadow-lg rounded overflow-hidden">
                {/* <Image
                  className="object-covers"
                  width={'100%'}
                  height={'90%'}
                  preview={false}
                  // src={membership.productImageLocation}
                  src="https://zos.alipayobjects.com/rmsportal/jkjgkEfvpUPVyRjUImniVslZfWPnJuuZ.png"
                /> */}
                <Carousel showArrows={true} showThumbs={false} className="h-88" >
                  {[
                    "https://images.unsplash.com/photo-1612817288484-6f916006741a?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxzZWFyY2h8Mnx8YmVhdXR5JTIwcHJvZHVjdHN8ZW58MHx8MHx8fDA%3D&w=1000&q=80",
                    "https://thumbs.dreamstime.com/b/set-care-beauty-products-skin-29817248.jpg",
                    "https://thumbs.dreamstime.com/z/bath-beauty-products-24145725.jpg"
                  ].map((item) => {
                    return <Image
                      key={item}
                      className="object-covers"
                      width={'100%'}
                      height={'100%'}
                      preview={false}
                      onClick={() => { setCarouselModel(true) }}
                      src={item}
                    // src={membership.productImageLocation}
                    />
                  })}
                </Carousel>

                {/* {(!membership.product_with_inventory && isPurchasedList) ? */}
                <Button type="primary"
                  block={true}
                  className="text-white text-sm cursor-pointer absolute bottom-0 rounded-none flex sm:h-10 pt-2"
                  onClick={() => {
                    if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                      window.location.href = loginUrl;
                    } else {
                      formik.setFieldValue("name", membership.productName);
                      openListNowModal();
                    }
                  }}
                >
                  <Row className="mx-auto flex"> {tagIcon()} &nbsp; List for Sale</Row>
                </Button>
                {/* : null} */}
              </Col>
              <Col sm={12} lg={{span:12}} xl={{span:14, offset:1}} xxl={{span:17, offset:1}} className="border-grey shadow-lg leading-2 min-h-min rounded p-2 ">
                <Paragraph >
                  <Text disabled className="font-bold" >Sub Category</Text>
                  <Text strong className="float-right">{subCategory}</Text>
                </Paragraph>
                <Paragraph >
                  <Text disabled className="font-bold" >Company Name</Text>
                  <Text strong className="float-right">{manufacturer}</Text>
                </Paragraph>
                <Paragraph >
                  <Text disabled className="font-bold" >Duration</Text>
                  <Text strong className="float-right">{timePeriodInMonths} Month(s)</Text>
                </Paragraph>
                <Paragraph >
                  <Text disabled className="font-bold" >Savings</Text>
                  <Text strong type="success" className="float-right">${savings}</Text>
                </Paragraph>
                {membershipId && <Paragraph>
                  <Text disabled className="font-bold" >Membership ID</Text>
                  <Text strong className="float-right">{membershipId}</Text>
                </Paragraph>}
              </Col>
            </Row>
            {Inventories &&
              <Row className="mt-4">
                <Col span={24}>
                  {/* <Title level={5}>Inventories</Title> */}
                  {/* <Collapse
                    size="large"
                    items={[{ key: '1', label: 'This is default size panel header', children: <Table bordered pagination={false} columns={columns} dataSource={data} /> }]}
                  /> */}

                  <Collapse size="large">
                    <Collapse.Panel key="1" header={<Title level={5}>Inventories</Title>}>
                      <Table bordered className="inventory-table" pagination={false} columns={columns}  dataSource={data} />
                    </Collapse.Panel>
                  </Collapse>

                </Col>
              </Row>}
          </Col>

          {/* {open && (
            <DeleteProductModal
              open={open}
              handleCancel={handleCancel}
              product={state}
              debouncedSearchTerm={debouncedSearchTerm}
            />
          )}
          {editModalOpen && (
            <UpdateProductModal
              open={editModalOpen}
              handleCancel={handleEditModalClose}
              productToUpdate={state}
              categorys={categorys}
              debouncedSearchTerm={debouncedSearchTerm}
            />
          )} */}
        </Card>
      )}
      {visible && (
        <ListNowModal
          open={visible}
          user={user}
          handleCancel={closeListNowModal}
          onClick={openListNowModal}
          formik={formik}
          type="Sale"
          id={membershipId}
          getIn={getIn}
          isCreateMembershipSubmitting={isCreateInventorySubmitting}
        />
      )}

      <Modal
        title=""
        centered
        open={carouselModel}
        closeIcon={false}
        footer={null}
        onOk={() => setCarouselModel(false)}
        onCancel={() => setCarouselModel(false)}
        width={1000}
      >
        <Carousel showArrows={true} showThumbs={false}  >
          {[
            "https://images.unsplash.com/photo-1612817288484-6f916006741a?ixlib=rb-4.0.3&ixid=M3wxMjA3fDB8MHxzZWFyY2h8Mnx8YmVhdXR5JTIwcHJvZHVjdHN8ZW58MHx8MHx8fDA%3D&w=1000&q=80",
            "https://thumbs.dreamstime.com/b/set-care-beauty-products-skin-29817248.jpg",
            "https://thumbs.dreamstime.com/z/bath-beauty-products-24145725.jpg"
          ].map((item) => {
            return <Image
              key={item}
              className="object-covers"
              width={'100%'}
              height={'96%'}
              preview={false}
              src={item}
            // src={membership.productImageLocation}
            />
          })}
        </Carousel>
      </Modal>

    </>
  );
};

export default MembershipCardPurchased;