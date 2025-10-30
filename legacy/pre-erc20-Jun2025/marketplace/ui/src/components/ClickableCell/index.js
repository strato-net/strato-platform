import { useNavigate } from 'react-router-dom';

const ClickableCell = ({ children, href }) => {
  const navigate = useNavigate();

  return (
    <div
      style={{ cursor: 'pointer' }}
      onClick={() => {
        navigate(href);
      }}
    >
      {children === undefined || children === null || children.length === 0 ? (
        <span>&nbsp;</span>
      ) : (
        children
      )}
    </div>
  );
};

export default ClickableCell;
