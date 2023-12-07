import {
    Row,
    Col,
} from "antd";

const AddressComponent = ({ userAddress }) => {
    return (
        <Col>
            <Row>
                <b className="w-28">Name</b>
                <p>{decodeURIComponent(userAddress.shippingName)}</p>
            </Row>
            <Row className="flex flex-wrap">
                <b className="w-28">Address</b>
                <p className="w-52">
                    { userAddress.shippingAddressLine2 ?
                        decodeURIComponent(userAddress.shippingAddressLine1)+", "+decodeURIComponent(userAddress.shippingAddressLine2) 
                        : decodeURIComponent(userAddress.shippingAddressLine1)
                    }
                </p>
            </Row>
            <Row>
                <b className="w-28">City</b>
                <p>{decodeURIComponent(userAddress.shippingCity)}</p>
            </Row>
            <Row>
                <b className="w-28">State</b>
                <p>{decodeURIComponent(userAddress.shippingState)}</p>
            </Row>
            <Row>
                <b className="w-28">Zipcode</b>
                <p>{userAddress.shippingZipcode}</p>
            </Row>
        </Col>

    );
}

export default AddressComponent;