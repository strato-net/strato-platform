import React, { createContext, useContext, useReducer } from "react";
import reducer from "./reducer";

const MembershipServiceStateContext = createContext();
const MembershipServiceDispatchContext = createContext();

const MembershipServicesProvider = ({ children }) => {
  const initialState = {
    membershipService: null,
    isCreateMembershipServiceSubmitting: false,
    membershipServices: [],
    ismembershipServicesLoading: false,
    membershipServiceDetails: null,
    ismembershipServiceDetailsLoading: false,
    membershipServiceOwnership: null,
    isOwnershipmembershipServiceTransferring: false,
    membershipServiceUpdateObject: null,
    ismembershipServiceUpdating: false,
    membershipServicesAudit: [],
    ismembershipServicesAuditLoading: false,
    error: undefined,
    success: false,
    message: null,
    isAssetImportInProgress: false,
    assetsUploaded: 0,
    assetsUploadedErrors: [],
    isImportAssetsModalOpen: false,
    totalMembershipServices: 0
  };

  const [state, dispatch] = useReducer(reducer, initialState);

  return (
    <MembershipServiceStateContext.Provider value={state}>
      <MembershipServiceDispatchContext.Provider value={dispatch}>
        {children}
      </MembershipServiceDispatchContext.Provider>
    </MembershipServiceStateContext.Provider>
  );
};

const useMembershipServiceState = () => {
  const context = useContext(MembershipServiceStateContext);
  if (context === undefined) {
    throw new Error(
      `'useMembershipServiceState' must be used within a MembershipServicesProvider`
    );
  }
  return context;
};

const useMembershipServiceDispatch = () => {
  const context = useContext(MembershipServiceDispatchContext);
  if (context === undefined) {
    throw new Error(
      `'useMembershipServiceDispatch' must be used within a MembershipServicesProvider`
    );
  }
  return context;
};

const useMembershipServiceUnit = () => {
  return [useMembershipServiceState(), useMembershipServiceDispatch()];
};

export {
  useMembershipServiceDispatch,
  useMembershipServiceState,
  useMembershipServiceUnit,
  MembershipServicesProvider,
};
