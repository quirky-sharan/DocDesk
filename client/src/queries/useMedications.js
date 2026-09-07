import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from './apiClient';

export function useGetMedications(search = '') {
  const api = useApi();
  return useQuery({
    queryKey: ['medications', search],
    queryFn: () => api.get('/medications', { params: search ? { search } : {} }).then(r => r.data),
  });
}

export function useCreateMedication() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: data => api.post('/medications', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['medications'] }),
  });
}

export function useUpdateMedication() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => api.put(`/medications/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['medications'] }),
  });
}

export function useDeleteMedication() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: id => api.delete(`/medications/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['medications'] }),
  });
}
