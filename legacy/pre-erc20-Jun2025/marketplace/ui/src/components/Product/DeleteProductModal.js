import React from 'react';
import { DeleteOutlined } from '@ant-design/icons';
import { Modal, Spin } from 'antd';
import { actions } from '../../contexts/product/actions';
import { useProductDispatch, useProductState } from '../../contexts/product';
import TagManager from 'react-gtm-module';

const DeleteProductModal = ({
  open,
  handleCancel,
  product,
  debouncedSearchTerm,
}) => {
  const dispatch = useProductDispatch();
  const { isProductDeleting } = useProductState();

  const deleteProduct = async () => {
    if (!isProductDeleting) {
      const body = {
        productAddress: product.address,
      };

      window.LOQ.push([
        'ready',
        async (LO) => {
          await LO.$internal.ready('events');
          LO.events.track('Delete Product');
        },
      ]);
      TagManager.dataLayer({
        dataLayer: {
          event: 'delete_product',
        },
      });
      let isDone = await actions.deleteProduct(dispatch, body);

      if (isDone) {
        actions.fetchProduct(dispatch, 10, 0, debouncedSearchTerm);
        handleCancel();
      }
    }
  };

  return (
    <Modal
      open={open}
      centered
      onCancel={handleCancel}
      footer={[
        <div className="flex justify-evenly">
          <div
            onClick={deleteProduct}
            id="delete-product-yes"
            className="w-48 border border-primary rounded text-primary px-4 py-2 text-center cursor-pointer hover:text-white hover:bg-primary"
          >
            {isProductDeleting ? <Spin /> : 'Yes'}
          </div>
          <div
            onClick={handleCancel}
            id="delete-product-no"
            className="w-48 bg-primary rounded text-white px-4 py-2 text-center hover:bg-primaryHover cursor-pointer"
          >
            No
          </div>
        </div>,
      ]}
    >
      <h1
        className="text-center font-semibold text-lg text-primaryB"
        id="modal-title"
      >
        Delete
      </h1>
      <hr className="text-secondryD mt-3" />
      <div className="flex flex-col justify-around items-center my-10">
        <DeleteOutlined className="text-5xl text-error" />
        <p className="text-center mt-4 font-semibold text-primaryC text-lg">
          Are you sure you want to delete?
        </p>
      </div>
    </Modal>
  );
};

export default DeleteProductModal;
