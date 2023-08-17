import React, { createContext, useContext, useReducer } from "react";
import reducer from "./reducer";

const MembershipStateContext = createContext();
const MembershipDispatchContext = createContext();

const MembershipsProvider = ({ children }) => {
  const initialState = {
    membership: null,
    membershipServices: [],
    productFile: null,
    isProductFileLoading: false,
    isMembershipLoading: false,
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <MembershipStateContext.Provider value={state}>
      <MembershipDispatchContext.Provider value={dispatch}>
        {children}
      </MembershipDispatchContext.Provider>
    </MembershipStateContext.Provider>
  );
};

const useMembershipState = () => {
  const context = useContext(MembershipStateContext);
  if (context === undefined) {
    throw new Error(
      `'useMembershipState' must be used within a MembershipsProvider`
    );
  }
  return context;
};

const useMembershipDispatch = () => {
  const context = useContext(MembershipDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'useMembershipDispatch' must be used within a MembershipsProvider`
    );
  }
  return context;
};

const useMembershipUnit = () => {
  return [useMembershipState(), useMembershipDispatch()];
};

export {
  useMembershipDispatch,
  useMembershipState,
  useMembershipUnit,
  MembershipsProvider,
};
