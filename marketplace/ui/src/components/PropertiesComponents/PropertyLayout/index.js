import { Layout, Button } from 'antd';

const { Header } = Layout;

const PropertyLayout = ({ children }) => {
  return (
    <Layout>
      <Header 
      className='flex justify-end'
      style={{
        display: "flex",
        alignItems: "center",
        backgroundColor: "#001B71"
      }}>
          <Button style={{ backgroundColor: '#FD3200', color: '#FFFFFF' }}>
            List Property
          </Button>
      </Header>
      {children}
    </Layout>
  );
}

export default PropertyLayout;