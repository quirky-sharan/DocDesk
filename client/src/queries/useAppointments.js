import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApi } from './apiClient';

export function useGetAppointments(filters = {}) {
  const api = useApi();
  return useQuery({
    queryKey: ['appointments', filters],
    queryFn: () => api.get('/appointments', { params: filters }).then(r => r.data),
  });
}

export function useCreateAppointment() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: data => api.post('/appointments', data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }),
  });
}

export function useUpdateAppointment() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }) => api.put(`/appointments/${id}`, data).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }),
  });
}

export function useDeleteAppointment() {
  const api = useApi();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: id => api.delete(`/appointments/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['appointments'] }),
  });
}
