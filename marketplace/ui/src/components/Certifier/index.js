import React, { useState, useEffect } from "react";
import { Button, Input, notification, Typography } from "antd";
import CertifyEventModal from "./certifyEventModal";
import CertifyEventsList from "./CertifyEventsList";
import { useEventDispatch, useEventState } from "../../contexts/event";
import { actions as eventActions } from "../../contexts/event/actions";
import classNames from "classnames";

const { Search } = Input;
const { Title } = Typography;

const Certifier = ({ user }) => {
  const [isCertifyEventModalOpen, toggleCertifyEventModal] = useState(false);
  const [selectedObj, setSelectedObj] = useState([]);
  const eventsDispatch = useEventDispatch();
  const [api, contextHolder] = notification.useNotification();

  const {
    iseventUpdating,
    message,
    success
  } = useEventState();

  useEffect(() => {
    eventActions.fetchCertifyEvent(eventsDispatch);
  }, [eventsDispatch]);


  const handleCancel = (val) => {
    if (val === "clear") setSelectedObj([])
    toggleCertifyEventModal(false);
  }

  const handleCertifyModal = () => {
    if (selectedObj.length > 0) toggleCertifyEventModal(true)
    else eventActions.setMessage(eventsDispatch, "Atleast one event should be selected to update comment", false)
  }

  const eventToast = (placement) => {
    if (success) {
      api.success({
        message: message,
        onClose: eventActions.resetMessage(eventsDispatch),
        placement,
        key: 3,
      });
    } else {
      api.error({
        message: message,
        onClose: eventActions.resetMessage(eventsDispatch),
        placement,
        key: 4,
      });
    }
  };

  return (
    <>
      {contextHolder}
      <div className="mx-16 mt-14">
        <div className={classNames(
          user?.roles.includes("Certifier") && user?.roles.length === 1 
            ? "justify-between"
            : "justify-end w-24",
          "flex text-center py-1 rounded text-sm"
        )}>
          <Title level={5}>{user?.roles.includes("Certifier") && user?.roles.length === 1 ? "Certify Events" : ""}</Title>
          <div className="flex mb-2">
            <Search placeholder="Search" className="w-80 mr-6" />
            <Button
              type="primary"
              className="w-48"
              onClick={() => {
                handleCertifyModal()
              }}
            >
              Certify Event
            </Button>
          </div>
        </div>
        <CertifyEventsList selectedObj={selectedObj} setSelectedObj={setSelectedObj} />
        {isCertifyEventModalOpen && (
          <CertifyEventModal
            isCertifyEventModalOpen={isCertifyEventModalOpen}
            handleCancel={handleCancel}
            eventBatchId={selectedObj}
            dispatch={eventsDispatch}
            actions={eventActions}
            iseventUpdating={iseventUpdating}
          />
        )}
        {message && eventToast("bottom")}
      </div>
    </>
  );
};

export default Certifier;
