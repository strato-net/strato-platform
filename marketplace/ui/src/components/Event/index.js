import {
  Tabs,
  Button,
  notification,
  Input,
  Image,
  Typography,
  Spin
} from "antd";
import React, { useEffect, useState } from "react";
import CreateEventTypeModal from "./CreateEventTypeModal";
import { actions as eventActions } from "../../contexts/event/actions";
import { useEventDispatch, useEventState } from "../../contexts/event";
import useDebounce from "../UseDebounce";
import { Images } from "../../images";
import EventTypeList from "./EventTypeList";
import EventsList from "./EventsList";
import CreateEventModal from "./CreateEventModal";
import CertifyEventsList from "../Certifier/CertifyEventsList";
import CertifyEventModal from "../Certifier/certifyEventModal";
import { useLocation } from "react-router-dom";

import { actions as eventTypeActions } from "../../contexts/eventType/actions";
import { useEventTypeDispatch, useEventTypeState } from "../../contexts/eventType";


const { Text, Title } = Typography;
const { Search } = Input;

const Event = ({ user }) => {
  const { state } = useLocation();
  const { tab } = state;

  const [currentTab, setCurrentTab] = useState("");
  const [limit, setLimit] = useState(10);
  const [isCertifyEventModalOpen, toggleCertifyEventModal] = useState(false);
  const [api, contextHolder] = notification.useNotification();

  //event type
  const eventTypeDispatch = useEventTypeDispatch();
  const [isCreateEventTypeModalOpen, toggleCreateEventTypeModal] =
    useState(false);
  const [eventTypeOffset, setEventTypeOffset] = useState(0);
  const [eventTypeQueryValue, setEventTypeQueryValue] = useState("");
  const debouncedSearchTerm = useDebounce(eventTypeQueryValue, 1000);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(10);

  //events
  const [isCreateEventModalOpen, toggleCreateEventModal] = useState(false);
  const eventsDispatch = useEventDispatch();
  const [eventQueryValue, setEventQueryValue] = useState("");
  const debouncedEventSearchTerm = useDebounce(eventQueryValue, 1000);
  const [eventOffset, setEventOffset] = useState(0);

  //certify events
  // const [certifyEventOffset, setCertifyEventOffset] = useState(0);
  // const [certifyEventPage, setCertifyEventPage] = useState(1);
  // const [certifyEventTotal, setCertifyEventTotal] = useState(10);
  const [selectedObj, setSelectedObj] = useState([]);
  const [batchIds, setBatchIds] = useState([]);


  const {
    isEventTypesLoading,
    isCreateEventTypeSubmitting,
    eventTypes,
    message,
    success,
  } = useEventTypeState();

  useEffect(() => {
    eventTypeActions.fetchEventType(eventTypeDispatch, limit, eventTypeOffset, debouncedSearchTerm);
  }, [eventTypeDispatch, limit, eventTypeOffset, debouncedSearchTerm]);

  useEffect(() => {
    if (currentTab === 'CertifyEvents')
      eventActions.fetchCertifyEvent(eventsDispatch);
  }, [currentTab, eventsDispatch]);

  const {
    isCreateEventSubmitting,
    iseventUpdating,
    message: eventMsg,
    success: eventSuccess
  } = useEventState();

  useEffect(() => {
    setCurrentTab(tab);
  }, [tab])

  const onChange = (key) => {
    setCurrentTab(key);
    setSelectedObj([])
  };

  useEffect(() => {
    if (currentTab === 'Events')
      eventActions.fetchEvent(eventsDispatch, limit, eventOffset, debouncedEventSearchTerm, user.organization);
  }, [currentTab, eventsDispatch, limit, eventOffset, debouncedEventSearchTerm]);

  const openToast = (placement) => {
    if (success) {
      api.success({
        message: message,
        onClose: eventTypeActions.resetMessage(eventTypeDispatch),
        placement,
        key: 1,
      });
    } else {
      api.error({
        message: message,
        onClose: eventTypeActions.resetMessage(eventTypeDispatch),
        placement,
        key: 2,
      });
    }
  };

  const eventToast = (placement) => {
    if (eventSuccess) {
      api.success({
        message: eventMsg,
        onClose: eventActions.resetMessage(eventsDispatch),
        placement,
        key: 3,
      });
    } else {
      api.error({
        message: eventMsg,
        onClose: eventActions.resetMessage(eventsDispatch),
        placement,
        key: 4,
      });
    }
  };

  const queryHandle = (e) => {
    if (currentTab === 'EventType') {
      setEventTypeQueryValue(e.target.value);
      setEventTypeOffset(0);
    }
    else if (currentTab === 'Events') {
      setEventQueryValue(e.target.value);
      setEventOffset(0)
    }
  };

  const onPageChange = (page) => {
    setEventTypeOffset((page - 1) * limit);
    setPage(page);
  }

  useEffect(() => {
    let len = eventTypes.length;
    let total;
    if (len === limit) total = page * 10 + limit;
    else total = (page - 1) * 10 + limit;
    setTotal(total);
  }, [eventTypes]);


  const handleCancel = (val) => {
    if (val === "clear") setSelectedObj([])
    toggleCertifyEventModal(false);
  }

  const handleCertifyModal = () => {
    if (selectedObj.length > 0) toggleCertifyEventModal(true)
    else eventActions.setMessage(eventsDispatch, "Atleast one event should be selected to update comment", false)
  }

  const isSpinning = isEventTypesLoading &&
    !isCertifyEventModalOpen && !isCreateEventModalOpen && !isCreateEventTypeModalOpen;

  return (
    <>
      {contextHolder}
      {isSpinning ? <Spin spinning={isEventTypesLoading &&
        !isCertifyEventModalOpen && !isCreateEventModalOpen && !isCreateEventTypeModalOpen}
        size="large" className="h-screen flex justify-center items-center" /> :

        <>{eventTypes.length === 0 && eventTypeQueryValue === "" && eventTypeOffset === 0 ? (
          <div className="h-screen justify-center flex flex-col items-center">
            <Image src={Images.noEventPageSymbol} preview={false} />
            <Title level={3} className="mt-2">
              No events found
            </Title>
            <Text className="text-sm">Start creating event type</Text>
            <Button
              id="create-event-type-button"
              type="primary"
              className="w-44 h-9 bg-primary !hover:bg-primaryHover mt-6"
              onClick={() => toggleCreateEventTypeModal(true)}
            >
              Create Event Type
            </Button>
          </div>) :
          <Tabs
            className="mx-16 mt-14"
            defaultActiveKey="EventType"
            onChange={onChange}
            activeKey={currentTab}
            tabBarExtraContent={
              <>
                <Search
                  placeholder={
                    currentTab === "CertifyEvents"
                      ? "Search"
                      : "Search by Event Name"
                  }
                  value={currentTab === "EventType" ? eventTypeQueryValue : eventQueryValue}
                  size="middle"
                  className="w-80 h-9"
                  allowClear
                  onChange={queryHandle}
                />
                <Button
                  id={currentTab === "EventType"
                    ? "create-event-type-button" :currentTab === "Events"
                    ? "create-event-button":"certify-event-button"}
                  type="primary"
                  className="w-44 h-9 bg-primary !hover:bg-primaryHover ml-3"
                  onClick={() => {
                    currentTab === "EventType"
                      ? toggleCreateEventTypeModal(true)
                      : currentTab === "Events"
                        ? toggleCreateEventModal(true)
                        : handleCertifyModal()
                  }}
                >
                  {currentTab === "EventType"
                    ? "Create Event Type"
                    : currentTab === "Events"
                      ? "Add Event"
                      : "Certify Event"}
                </Button>
              </>
            }
            items={[
              {
                label: (
                  <p id="event-type-tab" className="font-medium text-base text-primary">Event Type</p>
                ),
                key: "EventType",
                children: <EventTypeList onPageChange={onPageChange} page={page} total={total} />,
              },
              {
                label: (
                  <p id="event-tab" className="font-medium text-base  text-primary">Events</p>
                ),
                key: "Events",
                children: <EventsList />,
              },
              {
                label: (
                  <p id="certify-event-tab" className="font-medium text-base  text-primary">
                    Certify Events
                  </p>
                ),
                key: "CertifyEvents",
                children: <CertifyEventsList selectedObj={selectedObj} setSelectedObj={setSelectedObj} />,
              },
            ]}
          />}</>}
      {isCreateEventTypeModalOpen && (
        <CreateEventTypeModal
          isCreateEventTypeModalOpen={isCreateEventTypeModalOpen}
          toggleCreateEventTypeModal={toggleCreateEventTypeModal}
          dispatch={eventTypeDispatch}
          actions={eventTypeActions}
          isCreateEventTypeSubmitting={isCreateEventTypeSubmitting}
        />
      )}
      {isCreateEventModalOpen && (
        <CreateEventModal
          isCreateEventModalOpen={isCreateEventModalOpen}
          toggleCreateEventModal={toggleCreateEventModal}
          dispatch={eventsDispatch}
          actions={eventActions}
          isCreateEventSubmitting={isCreateEventSubmitting}
          organization={user.organization}
        />
      )}
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
      {message && openToast("bottom")}
      {eventMsg && eventToast("bottom")}
    </>
  );
};

export default Event;
