import { useEffect, useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { api, qs } from './api.js';
import { useToast } from '../context/Toast.jsx';

/** GET a single resource. key is an array; path is the API path. */
export function useApi(key, path, options = {}) {
  return useQuery({ queryKey: key, queryFn: () => api.get(path), ...options });
}

/** GET a paginated list; keeps the previous page on screen while the next loads. */
export function useList(resource, params = {}, options = {}) {
  const path = `/${resource}${qs(params)}`;
  const query = useQuery({ queryKey: [...resource.split('/'), 'list', params], queryFn: () => api.page(path), placeholderData: keepPreviousData, ...options });
  return { ...query, rows: query.data?.rows ?? [], meta: query.data?.meta ?? null };
}

/** Mutation helper: toasts errors, optionally toasts success and invalidates query roots. */
export function useAction(fn, { invalidate = [], success, onSuccess, silentError = false } = {}) {
  const client = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (result, vars) => {
      for (const root of invalidate) client.invalidateQueries({ queryKey: [root] });
      if (success) toast.success(typeof success === 'function' ? success(result, vars) : success);
      onSuccess?.(result, vars);
    },
    onError: error => { if (!silentError) toast.error(error.message); }
  });
}

/** Keep filter/search/page state in the URL so views can be shared, bookmarked and survive refresh. */
export function useQueryState(defaults = {}) {
  const [sp, setSp] = useSearchParams();
  const state = { ...defaults };
  for (const key of Object.keys(defaults)) { const v = sp.get(key); if (v !== null) state[key] = v; }
  const set = useCallback(patch => {
    setSp(prev => {
      const next = new URLSearchParams(prev);
      for (const [k, v] of Object.entries(patch)) { if (v === undefined || v === null || v === '' || String(v) === String(defaults[k] ?? '')) next.delete(k); else next.set(k, String(v)); }
      if (!('page' in patch)) next.delete('page'); // any filter change goes back to page 1
      return next;
    }, { replace: true });
  }, [setSp]); // eslint-disable-line react-hooks/exhaustive-deps
  return [state, set];
}

export function useDebounced(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => { const id = setTimeout(() => setDebounced(value), delay); return () => clearTimeout(id); }, [value, delay]);
  return debounced;
}

export function useDocumentTitle(title) {
  useEffect(() => { document.title = title ? `${title} · OpsMitra` : 'OpsMitra — Your Business, Simplified by AI'; }, [title]);
}

/** Query roots that must refresh after any sale, order, purchase or payment changes stock/money. */
export const AFTER_TRANSACTION = ['sales', 'orders', 'products', 'customers', 'suppliers', 'purchases', 'dashboard', 'insights', 'notifications', 'reports'];
