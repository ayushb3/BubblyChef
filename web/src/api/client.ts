import {
  useQuery,
  useMutation,
  useQueryClient,
  QueryClient,
} from '@tanstack/react-query';
import type {
  PantryItem,
  CreatePantryItem,
  UpdatePantryItem,
  PantryListResponse,
  DeleteResponse,
  ScanReceiptResponse,
  ConfirmItem,
  ConfirmItemsResponse,
  UndoResponse,
  OcrStatusResponse,
} from '../types';

const API_BASE_URL = 'http://localhost:8888';

// Query client setup
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60, // 1 minute
      refetchOnWindowFocus: false,
    },
  },
});

// API Functions
async function fetchPantryItems(params?: {
  category?: string;
  location?: string;
  search?: string;
}): Promise<PantryListResponse> {
  const searchParams = new URLSearchParams();
  if (params?.category) searchParams.append('category', params.category);
  if (params?.location) searchParams.append('location', params.location);
  if (params?.search) searchParams.append('search', params.search);

  const url = `${API_BASE_URL}/api/pantry${
    searchParams.toString() ? `?${searchParams.toString()}` : ''
  }`;

  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch pantry items');
  return response.json();
}

async function fetchExpiringItems(days: number = 3): Promise<PantryItem[]> {
  const response = await fetch(
    `${API_BASE_URL}/api/pantry/expiring?days=${days}`
  );
  if (!response.ok) throw new Error('Failed to fetch expiring items');
  return response.json();
}

async function fetchPantryItem(id: string): Promise<PantryItem> {
  const response = await fetch(`${API_BASE_URL}/api/pantry/${id}`);
  if (!response.ok) throw new Error('Failed to fetch pantry item');
  return response.json();
}

async function createPantryItem(
  item: CreatePantryItem
): Promise<PantryItem> {
  const response = await fetch(`${API_BASE_URL}/api/pantry`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  if (!response.ok) throw new Error('Failed to create pantry item');
  return response.json();
}

async function updatePantryItem(
  id: string,
  item: UpdatePantryItem
): Promise<PantryItem> {
  const response = await fetch(`${API_BASE_URL}/api/pantry/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  if (!response.ok) throw new Error('Failed to update pantry item');
  return response.json();
}

async function deletePantryItem(id: string): Promise<DeleteResponse> {
  const response = await fetch(`${API_BASE_URL}/api/pantry/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete pantry item');
  return response.json();
}

// Receipt Scanning API Functions
async function uploadReceipt(file: File): Promise<ScanReceiptResponse> {
  const formData = new FormData();
  formData.append('image', file);

  const response = await fetch(`${API_BASE_URL}/api/scan/receipt`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to upload receipt: ${error}`);
  }
  return response.json();
}

async function confirmScanItems(
  requestId: string,
  items: ConfirmItem[]
): Promise<ConfirmItemsResponse> {
  const response = await fetch(`${API_BASE_URL}/api/scan/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: requestId, items }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to confirm items: ${error}`);
  }
  return response.json();
}

async function undoScan(requestId: string): Promise<UndoResponse> {
  const response = await fetch(`${API_BASE_URL}/api/scan/undo/${requestId}`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to undo scan: ${error}`);
  }
  return response.json();
}

async function checkOcrStatus(): Promise<OcrStatusResponse> {
  const response = await fetch(`${API_BASE_URL}/api/scan/ocr-status`);
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to check OCR status: ${error}`);
  }
  return response.json();
}

// React Query Hooks
export function usePantryItems(params?: {
  category?: string;
  location?: string;
  search?: string;
}) {
  return useQuery({
    queryKey: ['pantry', params],
    queryFn: () => fetchPantryItems(params),
  });
}

export function useExpiringItems(days: number = 3) {
  return useQuery({
    queryKey: ['pantry', 'expiring', days],
    queryFn: () => fetchExpiringItems(days),
  });
}

export function usePantryItem(id: string) {
  return useQuery({
    queryKey: ['pantry', id],
    queryFn: () => fetchPantryItem(id),
    enabled: !!id,
  });
}

export function useCreatePantryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createPantryItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pantry'] });
    },
  });
}

export function useUpdatePantryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, item }: { id: string; item: UpdatePantryItem }) =>
      updatePantryItem(id, item),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pantry'] });
    },
  });
}

export function useDeletePantryItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deletePantryItem,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pantry'] });
    },
  });
}

// Receipt Scanning React Query Hooks
export function useUploadReceipt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: uploadReceipt,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pantry'] });
    },
  });
}

export function useConfirmScanItems() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ requestId, items }: { requestId: string; items: ConfirmItem[] }) =>
      confirmScanItems(requestId, items),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pantry'] });
    },
  });
}

export function useUndoScan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: undoScan,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['pantry'] });
    },
  });
}

export function useOcrStatus() {
  return useQuery({
    queryKey: ['ocr-status'],
    queryFn: checkOcrStatus,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
}
