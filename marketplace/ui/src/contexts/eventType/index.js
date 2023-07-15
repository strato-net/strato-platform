import React, { createContext, useContext, useReducer } from "react";
import reducer from "./reducer";

const EventTypeStateContext = createContext();
const EventTypeDispatchContext = createContext();

const EventTypesProvider = ({ children }) => {
  const initialState = {
    eventType: null,
    isCreateEventTypeSubmitting: false,
    eventTypes: [],
    iseventTypesLoading: false,
    error: undefined,
    success: false,
    message: null
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <EventTypeStateContext.Provider value={state}>
      <EventTypeDispatchContext.Provider value={dispatch}>
        {children}
      </EventTypeDispatchContext.Provider>
    </EventTypeStateContext.Provider>
  );
};

const useEventTypeState = () => {
  const context = useContext(EventTypeStateContext);
  if (context === undefined) {
    throw new Error(
      `'useEventTypeState' must be used within a EventTypesProvider`
    );
  }
  return context;
};

const useEventTypeDispatch = () => {
  const context = useContext(EventTypeDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'useEventTypeDispatch' must be used within a EventTypesProvider`
    );
  }
  return context;
};

const useEventTypeUnit = () => {
  return [useEventTypeState(), useEventTypeDispatch()];
};

export {
  useEventTypeDispatch,
  useEventTypeState,
  useEventTypeUnit,
  EventTypesProvider,
};
