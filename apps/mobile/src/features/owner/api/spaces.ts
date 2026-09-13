import type {
  SpaceDetail,
  SpaceSummary,
  CreateSpace,
  UpdateSpace,
  SetSpacePhotos,
} from '@parkease/contracts/owner';

import { api, type Intent } from '@/lib/api';

export interface PaginatedResponse<T> {
  items: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export async function fetchMyListings(page = 1, limit = 20) {
  const { data } = await api.get<{ data: PaginatedResponse<SpaceSummary> }>('/owner/spaces', {
    params: { page, limit },
  });
  return data.data;
}

export async function fetchSpaceDetail(id: string) {
  const { data } = await api.get<{ data: SpaceDetail }>(`/owner/spaces/${id}`);
  return data.data;
}

export async function createSpace(body: CreateSpace, intent: Intent) {
  const { data } = await api.post<{ data: SpaceDetail }>('/owner/spaces', body, {
    headers: { 'Idempotency-Key': intent.idempotencyKey },
  });
  return data.data;
}

export async function updateSpace(id: string, body: UpdateSpace, intent: Intent) {
  const { data } = await api.put<{ data: SpaceDetail }>(`/owner/spaces/${id}`, body, {
    headers: { 'Idempotency-Key': intent.idempotencyKey },
  });
  return data.data;
}

export async function setSpacePhotos(id: string, body: SetSpacePhotos, intent: Intent) {
  const { data } = await api.post<{ data: SpaceDetail }>(`/owner/spaces/${id}/photos`, body, {
    headers: { 'Idempotency-Key': intent.idempotencyKey },
  });
  return data.data;
}

export async function toggleSpace(id: string, intent: Intent) {
  const { data } = await api.patch<{ data: { id: string; approvalStatus: string } }>(
    `/owner/spaces/${id}/toggle`,
    {},
    { headers: { 'Idempotency-Key': intent.idempotencyKey } },
  );
  return data.data;
}

export async function deleteSpace(id: string, intent: Intent) {
  await api.delete(`/owner/spaces/${id}`, {
    headers: { 'Idempotency-Key': intent.idempotencyKey },
  });
}
