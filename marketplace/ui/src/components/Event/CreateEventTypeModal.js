import React from "react";
import {
  Typography,
  Row,
  Button,
  Form,
  Input,
  Modal,
  Divider,
  Spin
} from "antd";
import { useFormik } from "formik";
import * as yup from "yup";


const EventSchema = () => {
  return yup.object().shape({
    name: yup.string().required("Event name is required"),
    description: yup.string().required("Event description is required"),
  });
};

const { Text } = Typography;
const { TextArea } = Input;

const CreateEventTypeModal = ({
  isCreateEventTypeModalOpen,
  toggleCreateEventTypeModal,
  isCreateEventTypeSubmitting,
  actions,
  dispatch
}) => {
  const formik = useFormik({
    initialValues: {
      name: "",
      description: "",
    },
    validationSchema: EventSchema,
    onSubmit: function (values) {
      handleFormSubmit(values);
    },
  });

  const handleFormSubmit = async (values) => {
    const body = {
      name: encodeURIComponent(values.name),
      description: encodeURIComponent(values.description),
    };
    let isDone = await actions.createEventType(dispatch, body);
    if (isDone) {
      actions.fetchEventType(dispatch, 10, 0, "");
      toggleCreateEventTypeModal(false);
    }
  };

  return (
    <Modal
      open={isCreateEventTypeModalOpen}
      onCancel={() => toggleCreateEventTypeModal(!isCreateEventTypeModalOpen)}
      title={
        <Text id="modal-title" className="block text-center text-xl font-semibold">
          Create Event Type
        </Text>
      }
      width={424}
      footer={[
        <Row className="justify-center">
          <Button
            id="create-event-type"
            type="primary"
            className="w-40 bg-primary !hover:bg-primaryHover"
            onClick={formik.handleSubmit}
            disabled={isCreateEventTypeSubmitting}
          >
            {isCreateEventTypeSubmitting ? <Spin /> : "Create Event Type"}
          </Button>
        </Row>,
      ]}
    >
      <Divider />
      <Form layout="vertical" className="mt-5">
        <Form.Item
          label={<Text className="text-xs text-primaryC">Name</Text>}
          name="name"
        >
          <Input
            label="name"
            placeholder="Event Name"
            name="name"
            onChange={formik.handleChange}
          />
          {formik.touched.name && formik.errors.name && (
            <span className="text-error text-xs">{formik.errors.name}</span>
          )}
        </Form.Item>

        <Form.Item
          label={<Text className="text-xs text-primaryC mt-5">Description</Text>}
          name="description"
        >
          <TextArea
            placeholder="Event Description"
            name="description"
            label="description"
            rows={5}
            onChange={formik.handleChange}
          />
          {formik.touched.description && formik.errors.description && (
            <span className="text-error text-xs">
              {formik.errors.description}
            </span>
          )}
        </Form.Item>
      </Form>
      <Divider className="mb-0" />
    </Modal>
  );
};

export default CreateEventTypeModal;
