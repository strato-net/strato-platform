import React, { useContext, useEffect, useRef, useState } from 'react';
import { Button, Form, Input, Table } from 'antd';


const EditableContext = React.createContext(null);
const EditableRow = ({ index, ...props }) => {
  const [form] = Form.useForm();
  return (
    <Form form={form} component={false}>
      <EditableContext.Provider value={form}>
        <tr {...props} />
      </EditableContext.Provider>
    </Form>
  );
};
const EditableCell = ({
  title,
  editable,
  children,
  dataIndex,
  record,
  handleSave,
  ...restProps
}) => {
  const [editing, setEditing] = useState(false);
  const inputRef = useRef(null);
  const form = useContext(EditableContext);
  useEffect(() => {
    if (editing) {
      inputRef.current.focus();
    }
  }, [editing]);
  const toggleEdit = () => {
    setEditing(!editing);
    form.setFieldsValue({
      [dataIndex]: record[dataIndex],
    });
  };
  const save = async () => {
    try {
      const values = await form.validateFields();
      toggleEdit();
      handleSave({
        ...record,
        ...values,
      });
    } catch (errInfo) {
      console.log('Save failed:', errInfo);
    }
  };
  let childNode = children;
  if (editable) {
    childNode = editing ? (
      <Form.Item
        style={{
          margin: 0,
        }}
        name={dataIndex}
        rules={[
          {
            required: true,
            message: `${title} is required.`,
          },
        ]}
      >
        <Input ref={inputRef} onPressEnter={save} onBlur={save} />
      </Form.Item>
    ) : (
      <div
        className="editable-cell-value-wrap"
        style={{
          paddingRight: 24,
        }}
        onClick={toggleEdit}
      >
        {children}
      </div>
    );
  }
  return <td {...restProps}>{childNode}</td>;
};
const Service = () => {
  const [dataSource, setDataSource] = useState([]);

  // This is going to have to be the total number of services recorded. 
  // When the table first loads set the count to the number of services
  const [count, setCount] = useState(1);

  const defaultColumns = [
    {
      title: 'User',
      dataIndex: 'user',
    },
    {
      title: 'Provider',
      dataIndex: 'provider',
      editable: true,
    },
    {
      title: 'Membership Id',
      dataIndex: 'membershipId',
      editable: true,
    },
    {
        title: 'Service',
        dataIndex: 'service',
        editable: true,
    },
    {
        title: 'Summary',
        dataIndex: 'summary',
        editable: true,
    },
    {
        title: 'Date',
        dataIndex: 'date',
        editable: true,
    },
    {
        title: 'Comments',
        dataIndex: 'comments',
        editable: true,
    },
    {
        title: 'Status',
        dataIndex: 'status',
        editable: true,
    },
    {
        title: 'Price Paid',
        dataIndex: 'pricePaid',
        editable: true,
    }
  ];

  // Going to have to add the different types of input fields here
  // Also will have to see how to hande adding a new row when the user hasn't filled out the previous row
  // No delete row buttton on mockup
  // Rows also have an editable column
  const handleAdd = () => {
    const newData = {
      key:`service-use-${count}`,
        user: `user-${count}`,
        provider: `provider-${count}`,
        membershipId: `membershipId-${count}`,
        service: `service-${count}`,
        summary: `summary-${count}`,
        date: `date-${count}`,
        comments: `comments-${count}`,
        status: `status-${count}`,
        pricePaid: `pricePaid-${count}`,
    };
    setDataSource([...dataSource, newData]);
    setCount(count + 1);
  };


  const handleSave = (row) => {
    const newData = [...dataSource];
    const index = newData.findIndex((item) => row.key === item.key);
    const item = newData[index];
    newData.splice(index, 1, {
      ...item,
      ...row,
    });
    setDataSource(newData);
  };
  const components = {
    body: {
      row: EditableRow,
      cell: EditableCell,
    },
  };
  
  const columns = defaultColumns.map((col) => {
    if (!col.editable) {
      return col;
    }
    return {
      ...col,
      onCell: (record) => ({
        record,
        editable: col.editable,
        dataIndex: col.dataIndex,
        title: col.title,
        handleSave,
      }),
    };
  });
  return (
    <div>
        <h1>Service Usage</h1>
      <Button
        onClick={handleAdd}
        type="primary"
        style={{
          marginBottom: 16,
        }}
      >
        Add Service Use
      </Button>
      <Button
        type="primary"
        style={{
          marginBottom: 16,
        }}
        >
            Save
        </Button>
      <Table
        components={components}
        rowClassName={() => 'editable-row'}
        bordered
        dataSource={dataSource}
        columns={columns}
      />
    </div>
  );
};
export default Service;