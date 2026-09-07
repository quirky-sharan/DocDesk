import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from './apiClient';

export function useGetBills(filters = {}) {
  const api = useApi();
  return useQuery({
    queryKey: ['bills', filters],
    queryFn: () => api.get('/billing', { params: filters }).then(r => r.data),
  });
}

export function useCreateBill() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: data => api.post('/billing', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bills'] }),
  });
}

export function useUpdateBill() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => api.put(`/billing/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bills'] }),
  });
}

export function useDeleteBill() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: id => api.delete(`/billing/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bills'] }),
  });
}
