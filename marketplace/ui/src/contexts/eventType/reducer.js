import { actionDescriptors } from "./actions";

const reducer = (state, action) => {
  switch (action.type) {
    case actionDescriptors.resetMessage:
      return {
        ...state,
        success: false,
        message: null
      };
    case actionDescriptors.setMessage:
      return {
        ...state,
        success: action.success,
        message: action.message
      };
    case actionDescriptors.createEventType:
      return {
        ...state,
        isCreateEventTypeSubmitting: true
      };
    case actionDescriptors.createEventTypeSuccessful:
      return {
        ...state,
        eventType: action.payload,
        isCreateEventTypeSubmitting: false
      };
    case actionDescriptors.createEventTypeFailed:
      return {
        ...state,
        error: action.error,
        isCreateEventTypeSubmitting: false
      };
    case actionDescriptors.fetchEventType:
      return {
        ...state,
        isEventTypesLoading: true
      };
    case actionDescriptors.fetchEventTypeSuccessful:
      return {
        ...state,
        eventTypes: action.payload,
        isEventTypesLoading: false
      };
    case actionDescriptors.fetchEventTypeFailed:
      return {
        ...state,
        error: action.error,
        isEventTypesLoading: false
      };
    default:
      throw new Error(`Unhandled action: '${action.type}'`);
  }
};

export default reducer;
