import React, { createContext, useContext, useReducer } from "react";
import reducer from "./reducer";

const RoleStateContext = createContext();
const RoleDispatchContext = createContext();

const RolesProvider = ({ children }) => {
  const initialState = {
    error: undefined,
    success: false,
    message: null,
    isRequestingMembership: false,
    requestedMembership: null,
    isUpdatingMembership: false,
    updatedMembership: null,
    isAddingMembership: false,
    addedMembership: null,
    pendingRequestsList: [],
    isPendingRequestsListLoading: false,
    requestsList: [],
    isRequestsListLoading: false,
    approvedUsersList: [],
    isApprovedUsersListLoading: false,
    isAcceptMembershipLoading : [],
    acceptOrRejectMembership: null
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <RoleStateContext.Provider value={state}>
      <RoleDispatchContext.Provider value={dispatch}>
        {children}
      </RoleDispatchContext.Provider>
    </RoleStateContext.Provider>
  );
};

const useRoleState = () => {
  const context = useContext(RoleStateContext);
  if (context === undefined) {
    throw new Error(
      `'useRoleState' must be used within a RolesProvider`
    );
  }
  return context;
};

const useRoleDispatch = () => {
  const context = useContext(RoleDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'useRoleDispatch' must be used within a RolesProvider`
    );
  }
  return context;
};

const useRoleUnit = () => {
  return [useRoleState(), useRoleDispatch()];
};

export {
  useRoleDispatch,
  useRoleState,
  useRoleUnit,
  RolesProvider,
};
