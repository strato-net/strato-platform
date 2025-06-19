import React, { createContext, useContext, useReducer } from 'react';
import reducer from './reducer'; // Ensure this points to the reducer we just created

// Adjusting context names to reflect their purpose for user activities
const UserActivityStateContext = createContext();
const UserActivityDispatchContext = createContext();

const UserActivityProvider = ({ children }) => {
  // Adjust initial state to match the user activity context
  const initialState = {
    userActivity: [],
    isUserActivityLoading: false,
    error: undefined,
    success: false,
    message: null,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <UserActivityStateContext.Provider value={state}>
      <UserActivityDispatchContext.Provider value={dispatch}>
        {children}
      </UserActivityDispatchContext.Provider>
    </UserActivityStateContext.Provider>
  );
};

// Providing hooks for accessing state and dispatch
const useUserActivityState = () => {
  const context = useContext(UserActivityStateContext);
  if (context === undefined) {
    throw new Error(
      `'useUserActivityState' must be used within a UserActivityProvider`
    );
  }
  return context;
};

const useUserActivityDispatch = () => {
  const context = useContext(UserActivityDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'useUserActivityDispatch' must be used within a UserActivityProvider`
    );
  }
  return context;
};

// A convenience hook to use both state and dispatch
const useUserActivityUnit = () => {
  return [useUserActivityState(), useUserActivityDispatch()];
};

export {
  useUserActivityDispatch,
  useUserActivityState,
  useUserActivityUnit,
  UserActivityProvider,
};
