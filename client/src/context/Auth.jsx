import { createContext, useCallback, useContext, useEffect, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';

const AuthContext = createContext(null);

/**
 * The server is the source of truth: the user is whoever GET /auth/me says the HttpOnly session cookie belongs to.
 * Nothing about the session is kept in localStorage, so an expired or revoked cookie can never show a stale dashboard.
 */
export function AuthProvider({ children }) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['me'],
    queryFn: async () => (await api.get('/auth/session')).user,
    staleTime: 5 * 60 * 1000, retry: false
  });

  // Drop every cached business record on identity changes, but keep the ['me'] query so observers stay attached.
  const resetData = useCallback(() => client.removeQueries({ predicate: q => q.queryKey[0] !== 'me' }), [client]);
  const setUser = useCallback(user => client.setQueryData(['me'], user), [client]);
  const signedOut = useCallback(() => { resetData(); client.setQueryData(['me'], null); }, [client, resetData]);

  useEffect(() => {
    const onUnauthorized = () => { if (client.getQueryData(['me'])) signedOut(); };
    window.addEventListener('opsmitra:unauthorized', onUnauthorized);
    return () => window.removeEventListener('opsmitra:unauthorized', onUnauthorized);
  }, [client, signedOut]);

  const value = useMemo(() => ({
    user: query.data ?? null,
    loading: query.isPending,
    error: query.error,
    retry: () => query.refetch(),
    async login(email, password) { const r = await api.post('/auth/login', { email, password }); resetData(); setUser(r.user); return r.user; },
    async register(fields) { const r = await api.post('/auth/register', fields); resetData(); setUser(r.user); return r.user; },
    async demo() { const r = await api.post('/auth/demo'); resetData(); setUser(r.user); return r.user; },
    async logout() { try { await api.post('/auth/logout'); } catch { /* cookie may already be gone */ } signedOut(); },
    async logoutEverywhere() { await api.post('/auth/logout-all'); signedOut(); },
    setUser
  }), [query.data, query.isPending, query.error, resetData, setUser, signedOut]); // eslint-disable-line react-hooks/exhaustive-deps

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);
