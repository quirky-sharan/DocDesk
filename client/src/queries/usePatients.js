import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from './apiClient';

export function useGetPatients(search = '') {
  const api = useApi();
  return useQuery({
    queryKey: ['patients', search],
    queryFn: () => api.get('/patients', { params: search ? { search } : {} }).then(r => r.data),
  });
}

export function useCreatePatient() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: data => api.post('/patients', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patients'] }),
  });
}

export function useUpdatePatient() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => api.put(`/patients/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patients'] }),
  });
}

export function useDeletePatient() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: id => api.delete(`/patients/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['patients'] }),
  });
}
