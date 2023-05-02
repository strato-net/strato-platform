import React, { useState } from "react";
import {
  notification,
  Input,
  Space,
  Modal,
  Typography,
  Divider,
  Row,
  Image,
  Col,
  Upload,
  Button,
  Spin,
} from "antd";
import { Images } from "../../images";
import { DownloadOutlined, PaperClipOutlined } from "@ant-design/icons";
import { downloadSample } from "../../helpers/utils";
import { usePapaParse } from "react-papaparse";

const UploadSerialNumberModal = ({
  isUploadSerialNumberModalOpen,
  toggleUploadSerialNumberModal,
  product,
  chainId,
  Id,
  orderId,
  dispatch,
  actions,
  isLoading,
}) => {
  const [serialNumbers, setSerialNumbers] = useState([]);
  const [serialNumbersStr, setSerialNumbersStr] = useState("");
  const { Text, Title } = Typography;
  const { TextArea } = Input;
  const { readString } = usePapaParse();
  const [uploadErr, setUploadErr] = useState("");
  const [api, contextHolder] = notification.useNotification();

  const uploadCSV = (e) => {
    const csvFile = e.file.originFileObj;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const contents = readString(reader.result, { header: true });

      if (contents.data.length === 0) {
        setUploadErr("No records to import");
        return;
      }

      if (!contents.data[0]["ItemSerialNumber"]) {
        setUploadErr("Missing required column 'ItemSerialNumber'");
        return;
      }

      let serialNumbers = "",
        serialNumArr = [];
      for (let i = 0; i < contents.data.length; i++) {
        const row = contents.data[i];
        if(row["ItemSerialNumber"]){
          serialNumArr.push(row["ItemSerialNumber"]);
          serialNumbers += row["ItemSerialNumber"] + ",";
        }
      }
      serialNumbers = serialNumbers.substring(0, serialNumbers.length - 1);
      setSerialNumbers(serialNumArr);
      setSerialNumbersStr(serialNumbers);
    };
    reader.readAsText(csvFile);
  };

  const handleFormSubmit = async () => {
    if (serialNumbers.length !== product.quantity) {
      setUploadErr("Serial number length and quantity must be same");
      return;
    }

    const body = {
      orderId: orderId,
      chainId: chainId,
      orderLineId: product.address,
      serialNumber: serialNumbers,
    };
    let isDone = await actions.createOrderLineItem(dispatch, body);
    if (isDone) {
      toggleUploadSerialNumberModal(false);
      actions.fetchOrderDetails(dispatch, Id, chainId);
    }
  };

  const openToast = (placement) => {
    api.error({
      message: uploadErr,
      onClose: setUploadErr(""),
      placement,
      key: 1,
    });
  };

  return (
    <Modal
      open={isUploadSerialNumberModalOpen}
      title={
        <Text className="block text-center text-xl font-semibold">
          Upload Serial Number
        </Text>
      }
      width="50%"
      onCancel={() =>
        toggleUploadSerialNumberModal(!isUploadSerialNumberModalOpen)
      }
      // confirmLoading={isCreateSubmitting}
      footer={[
        <Row className="justify-center">
          <Button
            id="confirm-button"
            type="primary"
            className="w-1/4 h-9 bg-primary !hover:bg-primaryHover"
            onClick={handleFormSubmit}
            disabled={isLoading}
          >
            Upload
          </Button>
        </Row>,
      ]}
    >
      {contextHolder}

      <Divider />
      {isLoading ? (
        <div className="h-40 flex justify-center items-center">
          <Spin spinning={isLoading} size="large" />
        </div>
      ) : (
        <div>
          <Row>
            <Image width={75} height={60} src={product.imageUrl} />
            <Col className="ml-6 mb-10">
              <Title level={5}>{decodeURIComponent(product.productName)}</Title>
              <Space className="text-[13px]">
                <Text className="text-primaryC">Manufacturer</Text>
                <Text>:</Text>
                <Text className="text-primaryB">{decodeURIComponent(product.manufacturer)}</Text>
              </Space>
            </Col>
          </Row>
          <div className="mt-4 flex justify-between items-center">
            <div>Serial Numbers</div>
            <div className="flex items-center">
              <div className="flex items-center" onClick={downloadSample}>
                <DownloadOutlined className="text-primary text-sm font-medium cursor-pointer hover:text-primaryHover" />
                <div className="text-primary ml-2 text-xs font-medium cursor-pointer hover:text-primaryHover">
                  Download Sample CSV
                </div>
              </div>
              <Upload
                onChange={uploadCSV}
                accept=".csv"
                customRequest={() => {}}
                showUploadList={false}
              >
                <div className="ml-8 flex items-center">
                  <PaperClipOutlined className="text-primary text-sm font-medium cursor-pointer hover:text-primaryHover" />
                  <div className="text-primary ml-2 text-xs font-medium cursor-pointer hover:text-primaryHover">
                    Upload CSV
                  </div>
                </div>
              </Upload>
            </div>
          </div>
          <TextArea
            label="serialNumbers"
            className="mt-2"
            rows={4}
            disabled={true}
            value={serialNumbersStr}
            placeholder="Upload serial numbers using upload CSV option"
          />
        </div>
      )}

      <Divider className="mb-0" />
      {uploadErr && openToast("bottom")}
    </Modal>
  );
};

export default UploadSerialNumberModal;
