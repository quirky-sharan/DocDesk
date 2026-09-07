import { createContext, useContext, useState, useCallback } from 'react';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem('docdesk_token'));
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('docdesk_user');
    return raw ? JSON.parse(raw) : null;
  });

  const login = useCallback((userData, tok) => {
    setToken(tok);
    setUser(userData);
    localStorage.setItem('docdesk_token', tok);
    localStorage.setItem('docdesk_user', JSON.stringify(userData));
  }, []);

  const logout = useCallback(() => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('docdesk_token');
    localStorage.removeItem('docdesk_user');
  }, []);

  return (
    <AuthContext.Provider value={{ token, user, login, logout, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
