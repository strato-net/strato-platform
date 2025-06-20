import React, { useEffect, useState } from 'react';
import classNames from 'classnames';
import { Card, Popover, Spin } from 'antd';
import { MoreOutlined, EditOutlined, DeleteOutlined } from '@ant-design/icons';
import DeleteProductModal from './DeleteProductModal';
import UpdateProductModal from './UpdateProductModal';
import { UNIT_OF_MEASUREMENTS } from '../../helpers/constants';

const ProductCard = ({ product, categorys, debouncedSearchTerm }) => {
  const [state, setState] = useState(null);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [open, setOpen] = useState(false);

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

  useEffect(() => {
    setState(product);
  }, [product]);

  return (
    <>
      {state === null ? (
        <div className="h-screen flex justify-center items-center">
          <Spin />
        </div>
      ) : (
        <Card className="w-full mt-6" id="product">
          <div className="flex">
            <img className="w-52 object-cover" alt="" src={state.imageUrl} />
            <div className="ml-12 w-full">
              <div className="flex justify-between items-center">
                <div className="flex items-center">
                  <h3 className="font-semibold text-primaryB text-xl">
                    {decodeURIComponent(state.name)}
                  </h3>
                  <p className="font-medium text-secondryB text-base ml-2">
                    ({state.category})
                  </p>
                </div>
                <Popover
                  placement="bottomLeft"
                  open={openPop}
                  onOpenChange={handleOpenChange}
                  title={
                    <div className="font-medium">
                      <div
                        className="flex items-center cursor-pointer"
                        onClick={showEditModal}
                        id="edit-button"
                      >
                        <EditOutlined />
                        <p className="ml-3">Edit</p>
                      </div>
                      <div
                        className="flex items-center mt-2 cursor-pointer"
                        onClick={showModal}
                        id="delete-button"
                      >
                        <DeleteOutlined />
                        <p className="ml-3">Delete</p>
                      </div>
                    </div>
                  }
                  trigger="click"
                >
                  <MoreOutlined />
                </Popover>
              </div>
              <p className="text-sm text-secondryB mt-1.5">
                {decodeURIComponent(state.description)
                  .replace(/%0A/g, '\n')
                  .split('\n')
                  .map((line, index) => (
                    <React.Fragment key={index}>
                      {line}
                      <br />
                    </React.Fragment>
                  ))}{' '}
              </p>
              <div className="flex mt-1.5 items-center">
                <p className="text-primaryC text-sm w-40">Sub Category</p>
                <p text-secondryB text-sm>
                  :
                </p>
                <p className="text-secondryB text-sm ml-3">
                  {state.subCategory}
                </p>
              </div>
              <div className="flex mt-1.5 items-center">
                <p className="text-primaryC text-sm w-40">Manufacturer</p>
                <p text-secondryB text-sm>
                  :
                </p>
                <p className="text-secondryB text-sm ml-3">
                  {decodeURIComponent(state.manufacturer)}
                </p>
              </div>
              <div className="flex mt-1.5 items-center">
                <p className="text-primaryC text-sm w-40">
                  Unit of Measurement
                </p>
                <p text-secondryB text-sm>
                  :
                </p>
                <p className="text-secondryB text-sm ml-3">
                  {UNIT_OF_MEASUREMENTS[state.unitOfMeasurement]}
                </p>
              </div>
              <div className="flex mt-1.5 items-center">
                <p className="text-primaryC text-sm w-40">
                  Least Sellable Unit
                </p>
                <p text-secondryB text-sm>
                  :
                </p>
                <p className="text-secondryB text-sm ml-3">
                  {state.leastSellableUnit}
                </p>
              </div>
              <div
                className={classNames(
                  state.isActive
                    ? 'text-success bg-[#EAFFEE]'
                    : 'text-orange bg-[#FFF6EC]',
                  'text-center py-1 rounded w-24 text-sm mt-2.5'
                )}
              >
                <p>{state.isActive ? 'Active' : 'Inactive'}</p>
              </div>
            </div>
          </div>
          {open && (
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
          )}
        </Card>
      )}
    </>
  );
};

export default ProductCard;
