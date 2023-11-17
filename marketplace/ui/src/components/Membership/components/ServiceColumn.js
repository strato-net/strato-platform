import { Typography } from "antd";
const { Text } = Typography;

export const ServiceColumn = () => {
  return [
    {
      title: (
        <Text className="text-primaryC font-semibold text-base">Name</Text>
      ),
      dataIndex: "serviceName",
      key: "name",
      render: (text) => <p>{decodeURIComponent(text)}</p>,
    },
    {
      title: (
        <Text className="text-primaryC font-semibold text-base">
          Description
        </Text>
      ),
      dataIndex: "serviceDesc",
      key: "serviceDesc",
      render: (text) => <p>{decodeURIComponent(text)}</p>,
    },
    {
      title: (
        <Text className="text-primaryC font-semibold text-base">
          Membership Price
        </Text>
      ),
      dataIndex: "memberPrice",
      key: "memberPrice",
      render: (text) => (
        <p className="text-left">${decodeURIComponent(text)}</p>
      ),
    },
    {
      title: (
        <Text className="text-primaryC font-semibold text-base">
          Non-Membership Price
        </Text>
      ),
      dataIndex: "nonMemberPrice",
      key: "nonMemberPrice",
      render: (text) => (
        <p className="text-left">${decodeURIComponent(text)}</p>
      ),
    },
    {
      title: (
        <Text className="text-primaryC font-semibold text-base">Uses</Text>
      ),
      dataIndex: "uses",
      key: "uses",
      render: (text) => <p className="text-left">{decodeURIComponent(text)}</p>,
    },
  ]
}
