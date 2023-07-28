import React, { useState } from 'react'
import { Button } from 'antd';
import PropertyCreateModal from './PropertyCreateModal';
import PropertyCreateConfirmModal from './PropertyCreateConfirmModal';

function PropertyHeaderBtns({ tab }) {
  const [isCreateModalOpen, toggleCreateModal] = useState(false);
  const [modalView, setModalView] = useState(true);
  const [isCreateConfirmModalOpen, toggleCreateConfirmModal] = useState(false);

  return (
    <>
    {/* Modals for creating property listings */}
      {tab === 'home' &&
        <Button style={{ backgroundColor: '#FD3200', color: '#FFFFFF' }}
          onClick={() => {
            toggleCreateModal(true)
          }}
        >List Property</Button>
      }
        <PropertyCreateModal 
        isCreateModalOpen={isCreateModalOpen}
        toggleCreateModal={toggleCreateModal} 
        modalView={modalView}
        setModalView={setModalView}
        isCreateConfirmModalOpen={isCreateConfirmModalOpen}
        toggleCreateConfirmModal={toggleCreateConfirmModal}
        />
        <PropertyCreateConfirmModal
        isCreateConfirmModalOpen={isCreateConfirmModalOpen}
        toggleCreateConfirmModal={toggleCreateConfirmModal}
        />

    {/* Modals for editting property listings from the users organization */}
      {tab === 'details' &&
        <Button style={{ backgroundColor: '#FD3200', color: '#FFFFFF' }}>
          Edit Property
        </Button>
      }
    </>
  )
}

export default PropertyHeaderBtns