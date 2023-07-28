import { Layout } from 'antd';
import PropertyHeaderBtns from '../PropertyHeaderBtns';

const { Header } = Layout;

const PropertyLayout = ({ children, tab }) => {

  return (
    <Layout>
      <Header
        className='flex justify-end'
        style={{
          display: "flex",
          alignItems: "center",
          backgroundColor: "#001B71"
        }}>
        <PropertyHeaderBtns tab={tab} />
      </Header>
      {children}
    </Layout>
  );
}

export default PropertyLayout;