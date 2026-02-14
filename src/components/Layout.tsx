import { NavLink, Outlet } from 'react-router-dom';

export default function Layout() {
  return (
    <div className="page">
      <header className="header">
        <div className="container header__inner">
          <NavLink to="/" className="brand">
            Portfolio
          </NavLink>
          <nav className="nav">
            <NavLink to="/" end className="nav__link">
              Home
            </NavLink>
            <NavLink to="/?tab=work" className="nav__link">
              Work
            </NavLink>
          </nav>
        </div>
      </header>

      <main className="container main">
        <Outlet />
      </main>

      <footer className="footer">
        <div className="container footer__inner">
          <span>© {new Date().getFullYear()} Your Name</span>
          <span className="footer__sep">·</span>
          <a href="https://github.com/" target="_blank" rel="noreferrer">
            GitHub
          </a>
          <span className="footer__sep">·</span>
          <a href="https://www.linkedin.com/" target="_blank" rel="noreferrer">
            LinkedIn
          </a>
        </div>
      </footer>
    </div>
  );
}
