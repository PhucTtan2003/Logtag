import '../styles/SideBar.css';

type Props = {
  onSelectProduct: (id: string) => void;
};

const user = {
  name: 'Finn',
  role: 'Admin',
};

const mockProducts = ['SP001', 'SP002', 'SP003', 'SP004', 'SP005', 'SP006'];

export default function SideBar({ onSelectProduct }: Props) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>🌡️ Hệ thống Admin</h1>
      </div>

      <div className="sidebar-user">
        <p className="user-name">👤 {user.name}</p>
        <p className="user-role">{user.role}</p>
      </div>

      <nav className="sidebar-products">
        <h2>Danh sách sản phẩm</h2>
        <ul>
          {mockProducts.map((id) => (
            <li key={id} onClick={() => onSelectProduct(id)}>
              {id}
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
