import React, { useEffect } from "react";
import { Card, Divider, Spin } from "antd";
import { useNavigate } from "react-router-dom";
import { useAuthenticateDispatch, useAuthenticateState } from "../../contexts/authentication";
import { actions as authActions } from "../../contexts/authentication/actions";

const WaitingApproval = () => {

    const navigate = useNavigate();
    const authDispatch = useAuthenticateDispatch();
    const { isCheckingAuthentication, user } = useAuthenticateState();

  

    useEffect(() => {
        checkMeData();
    }, [authDispatch]);

    const checkMeData = async () => {
        await authActions.check(authDispatch);
        if (user?.roles.length !== 0 || user?.pendingMembershipRequests.length === 0) {
            navigate('/');
        }
    }


    return (
        <div>
            <div className="flex justify-center mt-32">
                {
                    isCheckingAuthentication ? <Spin size="large" /> :
                        <Card className="w-[28rem]" bodyStyle={{ padding: "0" }}>
                            <h1 className="text-center text-black text-xl font-bold mt-6">Wait for Approval</h1>
                            <Divider />
                            <p className="text-left mx-6">Thank you for submitting your Role Request. We have successfully received your request and it is currently pending review by the Administrators.</p>
                            <Divider />
                        </Card>
                }
            </div>

        </div>
    );
};

export default WaitingApproval;
