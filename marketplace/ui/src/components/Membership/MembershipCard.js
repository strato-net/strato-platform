import React, { useEffect, useState } from "react";
import { useFormik, getIn } from "formik";
import classNames from "classnames";
import { Card, Popover, Spin, Button, Table, Typography, Row } from "antd";
import { MoreOutlined, EditOutlined, DeleteOutlined } from "@ant-design/icons";
import ListForSaleModal from "./ListForSaleModal";
// import DeleteProductModal from "./DeleteProductModal";
// import UpdateProductModal from "./UpdateProductModal";
import { UNIT_OF_MEASUREMENTS } from "../../helpers/constants";
import routes from "../../helpers/routes";
import { useNavigate } from "react-router-dom";
import { useAuthenticateState } from "../../contexts/authentication";
import ListNowModal from "../Membership/ListNowModal";
import PublishNowModal from "../Membership/PublishNowModal";
import * as yup from "yup";
import { INVENTORY_STATUS } from "../../helpers/constants";
import {
  useInventoryDispatch,
  useInventoryState,
} from "../../contexts/inventory";
import { actions } from "../../contexts/inventory/actions";
import TagManager from "react-gtm-module";

const { Title } = Typography;

const MembershipCard = ({
  user,
  membership,
  categorys,
  debouncedSearchTerm,
}) => {
  const [state, setState] = useState(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const naviroute = routes.MembershipDetail.url;
  const [visible, setVisible] = useState(false);
  const [viewable, setViewable] = useState(false);
  console.log("membership", membership)


  let { hasChecked, isAuthenticated, loginUrl } = useAuthenticateState();
  const { isCreateInventorySubmitting } = useInventoryState();
  const dispatch = useInventoryDispatch();
  const showModal = () => {
    hide();
    setOpen(true);
  };

  const handleCancel = () => {
    setOpen(false);
  };

  const [openPop, setOpenPop] = useState(false);
  const hide = () => {
    setOpenPop(false);
  };
  const handleOpenChange = (newOpen) => {
    setOpenPop(newOpen);
  };

  const showEditModal = () => {
    hide();
    setEditModalOpen(true);
  };

  const handleEditModalClose = () => {
    setEditModalOpen(false);
  };

  console.log("membership", state);

  useEffect(() => {
    setState(membership);
  }, [membership]);


  const callDetailPage = (index, address) => {
    if (state !== null && state !== undefined) {
      navigate(`${naviroute.replace(":id", state.address)}`, { state: { isCalledFromMembership: true, inventoryId: (state.inventoryAddress !== undefined || state.inventoryAddress !== null) ? state.inventoryAddress : null } });
    }

  }

  const closeListNowModal = () => {
    setVisible(false);
  };

  const openListNowModal = () => {
    setVisible(true);
  };

  const openInventoryNowModal = () => {
    setViewable(true);
  };

  const closeInventoryNowModal = () => {
    setViewable(false);
  };

  const getSchema = (isListNowModalOpen) => {
    return yup.object().shape({
      name: yup.string().required("Membership name is required"),
      price: yup.number().when("isListNowModalOpen", {
        is: () => isListNowModalOpen, // Use a function to evaluate the condition
        then: yup.number().required("Price is required"),
      }),
      quantity: yup.number().when("isListNowModalOpen", {
        is: () => isListNowModalOpen, // Use a function to evaluate the condition
        then: yup.number().required("Quantity is required"),
      }),
    });
  };

  const initialValues = {
    name: "",
    price: "",
    quantity: ""
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


  const previewCol = (indx, address) => (<Button type="text"
    className="text-primary text-sm cursor-pointer"
    onClick={callDetailPage.bind(this, indx, address)}
  >
    Preview
  </Button>)

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


  let data = membership.inventories.map((inventory, index) => {
    return {
      key: index,
      name: inventory.block_timestamp,
      age: inventory.availableQuantity,
      published: updateCol(inventory, inventory.status === 1 ? "Published" : "Unpublished"),
      preview: previewCol(index, inventory.address),
      address: "$ " + String(inventory.pricePerUnit)
    }
  });

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



  const handleCreateFormSubmit = async (values) => {
    if (user) {
      if (formik.values.price !== "" && formik.values.quantity !== "") {
        const inventoryBody = {
          productAddress: membership.productId,
          quantity: formik.values.quantity,
          pricePerUnit: formik.values.price,
          // Generate random code for now
          batchId: `B-ID-${Math.floor(Math.random() * 1000000)}`,
          // Status should always be published if we use List Now
          status: INVENTORY_STATUS.PUBLISHED,
          serialNumber: [],
          taxPercentageAmount: formik.values.taxPercentageAmount,
          taxDollarAmount: formik.values.taxDollarAmount,
        };
        const createInventory = await actions.createInventory(
          dispatch,
          inventoryBody
        );

        if (createInventory) {
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
        <Card className="w-full mt-6" id="product">
          <div className="flex">
            <div className="text-center py-1 rounded w-24 text-sm mt-2.5">
              <img
                className="w-52 object-cover"
                alt=""
                src={membership.productImageLocation}
              />
              {membership.inventories.some(inv => inv.status === 1) ?
                (membership.inventories.every(inv => inv.status === 1) ?
                  (<Button type="primary" shape="round" style={{ background: "green", marginTop: "10px" }}> For Sale </Button>)
                  : (<Button type="primary" shape="round" style={{ background: "red", marginTop: "10px" }}> Retained </Button>))
                : (<Button type="primary" shape="round" style={{ background: "blue", marginTop: "10px" }}> Not for Sale </Button>)}
            </div>
            <div className="ml-12 w-full">
              <div className="flex justify-between items-center">
                <div className="flex items-center">
                  <h3 className="font-semibold text-primaryB text-xl">
                    {decodeURIComponent(membership.product.name)}
                  </h3>
                </div>
                {/* <div className="flex items-center">
                  {!membership.product_with_inventory ?
                    <Button type="text"
                      className="text-primary text-sm cursor-pointer"
                      onClick={() => {
                        if (hasChecked && !isAuthenticated && loginUrl !== undefined) {
                          window.location.href = loginUrl;
                        } else {
                          formik.setFieldValue("name", membership.product.name);
                          openListNowModal();
                        }
                      }}
                    >
                      List for Sale
                    </Button>
                    : null}
                </div> */}
              </div>
              <div className="flex mt-1.5 items-center">
                <p className="text-primaryC text-sm w-40">Sub Category</p>
                <p text-secondryB text-sm>
                  :
                </p>
                <p className="text-secondryB text-sm ml-3">
                  {membership.product.subCategory}
                </p>
              </div>
              <div className="flex mt-1.5 items-center">
                <p className="text-primaryC text-sm w-40">Company Name</p>
                <p text-secondryB text-sm>
                  :
                </p>
                <p className="text-secondryB text-sm ml-3">
                  {membership.product.manufacturer}
                </p>
              </div>
              <div className="flex mt-1.5 items-center">
                <p className="text-primaryC text-sm w-40">Duration</p>
                <p text-secondryB text-sm>
                  :
                </p>
                <p className="text-secondryB text-sm ml-3">
                  {membership.timePeriodInMonths} Month(s)
                </p>
              </div>
              <div className="flex mt-1.5 items-center">
                <p className="text-primaryC text-sm w-40">Savings</p>
                <p text-secondryB text-sm>
                  :
                </p>
                <p
                  style={{ color: "green" }}
                  className="text-primaryB font-bold text-sm ml-3"
                >
                  $ {membership.savings}
                </p>
              </div>
            </div>
          </div>
          <> </>
          <div style={{ marginTop: "20px", borderRadius: '10px', border: '1px solid #333', padding: '10px' }}>
            <Title level={5}>Inventories</Title>
            <Table bordered pagination={false} columns={columns} dataSource={data} />
          </div>
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
      {viewable && (
        <PublishNowModal
          open={viewable}
          user={user}
          handleCancel={closeInventoryNowModal}
          onClick={openInventoryNowModal}
          formik={formik}
          getIn={getIn}
          isCreateMembershipSubmitting={isCreateInventorySubmitting}
          inventory={formik.values.tempInv}
        />
      )}
      {visible && (
        <ListNowModal
          open={visible}
          handleCancel={closeListNowModal}
          user={user}
          onClick={openListNowModal}
          formik={formik}
          type="New"
          id="None"
          getIn={getIn}
          inventory={formik.values.tempInv}
        />
      )}
    </>
  );
};

export default MembershipCard;