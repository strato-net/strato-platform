import React, { createContext, useContext, useReducer } from "react";
import reducer from "./reducer";

const SellerStatusStateContext = createContext();
const SellerStatusDispatchContext = createContext();

const SellerStatusProvider = ({children}) => {
    const initialState = {
        success: false,
        message: null,
        changingSellerStatus: false,
        requestingReview: false,
    }
    const [state, dispatch] = useReducer(reducer, initialState);

    return (
        <SellerStatusStateContext.Provider value={state}>
            <SellerStatusDispatchContext.Provider value={dispatch}>
                {children}
            </SellerStatusDispatchContext.Provider>
        </SellerStatusStateContext.Provider>
    ); 
};

const useSellerStatusState = () => {
    const context = useContext(SellerStatusStateContext);
    if (context == undefined) {
        throw new Error (
            `'useSellerStatusState' must be used within a SellerStatusProvider`
        );
    }
    return context;
};

const useSellerStatusDispatch = () => {
    const context = useContext(SellerStatusDispatchContext);
    if (context == undefined) {
        throw new Error (
            `'useSellerStatusDispatch' must be used within a SellerStatusProvider`
        );
    }
    return context;
};

export {
    useSellerStatusState,
    useSellerStatusDispatch,
    SellerStatusProvider
};