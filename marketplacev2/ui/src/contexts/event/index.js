import React, { createContext, useContext, useReducer } from "react";
import reducer from "./reducer";

const EventStateContext = createContext();
const EventDispatchContext = createContext();

const EventsProvider = ({ children }) => {
  const initialState = {
    event: null,
    isCreateEventSubmitting: false,
    events: [],
    isEventsLoading: false,
    inventoryEvents: [],
    isInventoryEventsLoading: false,
    itemEvents: [],
    isItemEventsLoading: false,
    eventDetails: null,
    iseventDetailsLoading: false,
    certifyEvents: [],
    isCertifyEventsLoading: false,
    eventUpdateObject: null,
    iseventUpdating: false,
    eventsAudit: [],
    iseventsAuditLoading: false,
    error: undefined,
    success: false,
    message: null,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <EventStateContext.Provider value={state}>
      <EventDispatchContext.Provider value={dispatch}>
        {children}
      </EventDispatchContext.Provider>
    </EventStateContext.Provider>
  );
};

const useEventState = () => {
  const context = useContext(EventStateContext);
  if (context === undefined) {
    throw new Error(
      `'useEventState' must be used within a EventsProvider`
    );
  }
  return context;
};

const useEventDispatch = () => {
  const context = useContext(EventDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'useEventDispatch' must be used within a EventsProvider`
    );
  }
  return context;
};

const useEventUnit = () => {
  return [useEventState(), useEventDispatch()];
};

export {
  useEventDispatch,
  useEventState,
  useEventUnit,
  EventsProvider,
};
