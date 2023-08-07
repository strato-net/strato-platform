import React, { useState } from "react";
import { Modal, Upload, Row, Col, Button } from "antd";
import { HTTP_METHODS, apiUrl } from "../../helpers/constants";
import RestStatus from "http-status-codes";
import { InboxOutlined, UploadOutlined } from "@ant-design/icons";


const { Dragger } = Upload;

const UploadPhotosModal = ({
  isOpen,
  handleModal,
  url,
  body,
  isDisabled
}) => {
  return (
    <Row>
      <Modal
        open={isOpen}
        centered
        onCancel={() => handleModal(false)}
        width={885}
        title="Upload Photos"
        footer={[
          <Button onClick={() => handleModal(false)}>
            Cancel
          </Button>,
          <Button type="primary" onClick={() => { }}>
            Upload
          </Button>
        ]}
      >
        <Col span={24}>
          <Dragger
            action={`${apiUrl}${url}`}
            multiple={true}
            customRequest={async ({ action, file, onError, onProgress, onSuccess }) => {
              let formData = new FormData();
              formData.append("document", file);

              Object.keys(body).forEach((key) => {
                formData.append(key, body[key]);
              })

              try {
                onProgress({ percent: 100 }, file)
                const response = await fetch(action, {
                  method: HTTP_METHODS.POST,
                  credentials: "same-origin",
                  body: formData
                });

                const body = await response.json();

                if (response.status === RestStatus.OK) {
                  onSuccess(body, file);
                } else {
                  onError(response)
                }

              } catch (err) {
                onError(err)
              }
            }}>
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">Click or drag file to this area to upload</p>
            <p className="ant-upload-hint">
              Support for a single or bulk upload. Strictly prohibited from uploading company data or other
              banned files.
            </p>
            {/* <Button
              disabled={isDisabled}
              type="primary"
              icon={<UploadOutlined />}>
              Upload
            </Button> */}
          </Dragger>
        </Col>
      </Modal>
    </Row>
  );
};

export default UploadPhotosModal;


