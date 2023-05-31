import React from "react";
import { Typography, Row, Button, Form, Input, Modal, Divider, Spin } from "antd";
import { useFormik } from "formik";
import * as yup from "yup";

const CertifyEventSchema = () => {
  return yup.object().shape({
    comment: yup.string().required("Comment is required"),
  });
};

const { Text } = Typography;
const { TextArea } = Input;

const CertifyEventModal = ({
  isCertifyEventModalOpen,
  handleCancel,
  eventBatchId,
  actions,
  dispatch,
  iseventUpdating
}) => {
  const formik = useFormik({
    initialValues: {
      comment: "",
    },
    validationSchema: CertifyEventSchema,
    onSubmit: function (values) {
      handleUpdateCertifierComment(values)
    },
  });

  const handleUpdateCertifierComment = async (values) => {
    
    const body = {
      eventBatchId: eventBatchId,
      updates: {
        certifierComment: values.comment
      },
    };

    let isDone = await actions.updateEvent(dispatch, body);

    if (isDone) {
      actions.fetchCertifyEvent(dispatch);
      handleCancel("clear")
    }
  };


  return (
    <Modal
      open={isCertifyEventModalOpen}
      onCancel={() => handleCancel("")}
      title={
        <Text id="modal-title" className="block text-center text-xl font-semibold">
          Certify Event
        </Text>
      }
      width={672}
      footer={[
        <Row className="justify-center">
          <Button
            id="certify-event"
            type="primary"
            className="w-40 h-9 bg-primary !hover:bg-primaryHover"
            onClick={formik.handleSubmit}
            disabled={iseventUpdating}
          >
              {iseventUpdating ? <Spin /> : " Certify Event"} 
           
          </Button>
        </Row>,
      ]}
    >
      <Divider />
      <Form layout="vertical" className="mt-5" onSubmit={formik.handleSubmit}>
        <div className="w-full">
          <Form.Item
            name="comment"
            label={<Text className="text-xs text-primaryC">Comment</Text>}
          >
            <TextArea
              rows={5}
              name="comment"
              placeholder="Enter comment"
              value={formik.values.comment}
              onChange={formik.handleChange}
            />
            {formik.touched.comment && formik.errors.comment && (
              <span className="text-error text-xs">
                {formik.errors.comment}
              </span>
            )}
          </Form.Item>
        </div>
      </Form>
      <Divider className="mb-0" />
    </Modal>
  );
};

export default CertifyEventModal;
