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
  GenerateRecipeRequest,
  GenerateRecipeResponse,
  UserProfile,
  CreateUserProfileRequest,
  UpdateUserProfileRequest,
  ProfileResponse,
  ChatRequest,
  ChatResponse,
  ConversationHistoryTurn,
  Decoration,
  StreamEvent,
  FoodSearchResult,
  RecipeLibraryItem,
  RecipeDetailType,
  SaveRecipeRequest,
} from '../types';

export const API_BASE_URL = 'http://localhost:8888';

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
  if (params?.location) searchParams.append('storage', params.location);
  if (params?.search) searchParams.append('search', params.search);

  const url = `${API_BASE_URL}/pantry${
    searchParams.toString() ? `?${searchParams.toString()}` : ''
  }`;

  const response = await fetch(url);
  if (!response.ok) throw new Error('Failed to fetch pantry items');
  return response.json();
}

async function fetchExpiringItems(days: number = 3): Promise<PantryItem[]> {
  const response = await fetch(
    `${API_BASE_URL}/pantry/expiring?days=${days}`
  );
  if (!response.ok) throw new Error('Failed to fetch expiring items');
  const data: PantryListResponse = await response.json();
  return data.items;
}

async function fetchPantryItem(id: string): Promise<PantryItem> {
  const response = await fetch(`${API_BASE_URL}/pantry/${id}`);
  if (!response.ok) throw new Error('Failed to fetch pantry item');
  return response.json();
}

async function createPantryItem(
  item: CreatePantryItem
): Promise<PantryItem> {
  const response = await fetch(`${API_BASE_URL}/pantry`, {
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
  const response = await fetch(`${API_BASE_URL}/pantry/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(item),
  });
  if (!response.ok) throw new Error('Failed to update pantry item');
  return response.json();
}

async function deletePantryItem(id: string): Promise<DeleteResponse> {
  const response = await fetch(`${API_BASE_URL}/pantry/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete pantry item');
  return response.json();
}

// Receipt Scanning API Functions
async function uploadReceipt(file: File): Promise<ScanReceiptResponse> {
  const formData = new FormData();
  formData.append('image', file);

  const response = await fetch(`${API_BASE_URL}/scan/receipt`, {
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
  const response = await fetch(`${API_BASE_URL}/scan/confirm`, {
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
  const response = await fetch(`${API_BASE_URL}/scan/undo/${requestId}`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to undo scan: ${error}`);
  }
  return response.json();
}

async function checkOcrStatus(): Promise<OcrStatusResponse> {
  const response = await fetch(`${API_BASE_URL}/scan/ocr-status`);
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

// Food Library Search API
async function searchFoods(
  query: string,
  limit: number = 8,
): Promise<FoodSearchResult[]> {
  const params = new URLSearchParams({ q: query, limit: String(limit) });
  const response = await fetch(`${API_BASE_URL}/api/foods/search?${params}`);
  if (!response.ok) throw new Error('Failed to search foods');
  return response.json();
}

export function useFoodSearch(query: string, limit: number = 6) {
  return useQuery({
    queryKey: ['food-search', query, limit],
    queryFn: () => searchFoods(query, limit),
    enabled: query.trim().length >= 1,
    staleTime: 1000 * 60 * 5, // 5 minutes — library doesn't change
    placeholderData: (prev) => prev,
  });
}

// Recipe Generation API Functions
async function generateRecipe(
  request: GenerateRecipeRequest
): Promise<GenerateRecipeResponse> {
  const response = await fetch(`${API_BASE_URL}/recipes/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to generate recipe: ${error}`);
  }
  return response.json();
}

async function fetchRecipeSuggestions(): Promise<string[]> {
  const response = await fetch(`${API_BASE_URL}/recipes/suggestions`);
  if (!response.ok) throw new Error('Failed to fetch recipe suggestions');
  return response.json();
}

// Recipe Generation React Query Hooks
export function useGenerateRecipe() {
  return useMutation({
    mutationFn: generateRecipe,
  });
}

export function useRecipeSuggestions() {
  return useQuery({
    queryKey: ['recipe-suggestions'],
    queryFn: fetchRecipeSuggestions,
    staleTime: 1000 * 60, // 1 minute
  });
}

// ─── Chat suggestions ─────────────────────────────────────────────────────────

const CHAT_SUGGESTIONS = [
  "What can I make with what I have?",
  "I just bought milk, eggs, and cheese",
  "How long does cooked chicken last?",
  "What's expiring soon in my pantry?",
];

export function useChatSuggestions() {
  return { data: CHAT_SUGGESTIONS, isLoading: false };
}

// User Profile API Functions
async function fetchProfile(id: string): Promise<UserProfile> {
  const response = await fetch(`${API_BASE_URL}/profile/${id}`);
  if (!response.ok) throw new Error('Failed to fetch profile');
  const data: ProfileResponse = await response.json();
  return data.profile;
}

async function fetchProfileByEmail(email: string): Promise<UserProfile> {
  const response = await fetch(`${API_BASE_URL}/profile/email/${encodeURIComponent(email)}`);
  if (!response.ok) throw new Error('Failed to fetch profile');
  const data: ProfileResponse = await response.json();
  return data.profile;
}

async function fetchProfileByUsername(username: string): Promise<UserProfile> {
  const response = await fetch(`${API_BASE_URL}/profile/username/${encodeURIComponent(username)}`);
  if (!response.ok) throw new Error('Failed to fetch profile');
  const data: ProfileResponse = await response.json();
  return data.profile;
}

async function createProfile(
  request: CreateUserProfileRequest
): Promise<UserProfile> {
  const response = await fetch(`${API_BASE_URL}/profile`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to create profile: ${error}`);
  }
  const data: ProfileResponse = await response.json();
  return data.profile;
}

async function updateProfile(
  id: string,
  request: UpdateUserProfileRequest
): Promise<UserProfile> {
  const response = await fetch(`${API_BASE_URL}/profile/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to update profile: ${error}`);
  }
  const data: ProfileResponse = await response.json();
  return data.profile;
}

async function deleteProfile(id: string): Promise<DeleteResponse> {
  const response = await fetch(`${API_BASE_URL}/profile/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete profile');
  return response.json();
}

// User Profile React Query Hooks
export function useProfile(id: string | null) {
  return useQuery({
    queryKey: ['profile', id],
    queryFn: () => fetchProfile(id!),
    enabled: !!id,
  });
}

export function useProfileByEmail(email: string | null) {
  return useQuery({
    queryKey: ['profile', 'email', email],
    queryFn: () => fetchProfileByEmail(email!),
    enabled: !!email,
  });
}

export function useProfileByUsername(username: string | null) {
  return useQuery({
    queryKey: ['profile', 'username', username],
    queryFn: () => fetchProfileByUsername(username!),
    enabled: !!username,
  });
}

export function useCreateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, profile }: { id: string; profile: UpdateUserProfileRequest }) =>
      updateProfile(id, profile),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['profile', data.id] });
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

export function useDeleteProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: deleteProfile,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  });
}

// ─── Chat API ──────────────────────────────────────────────────────────────────

async function sendChatMessage(request: ChatRequest): Promise<ChatResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Chat request failed: ${error}`);
  }
  return response.json();
}

export function useChat() {
  return useMutation({
    mutationFn: sendChatMessage,
  });
}

// ─── Streaming Chat API ─────────────────────────────────────────────────────

/**
 * Stream chat messages via SSE from POST /v1/chat/stream.
 *
 * Parses SSE events and dispatches to the appropriate callback:
 * - onToken: called for each text chunk as it arrives
 * - onDone: called once with the full ChatResponse envelope
 * - onError: called if the stream or parsing fails
 */
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function streamChatMessage(
  request: ChatRequest,
  onToken: (token: string) => void,
  onDone: (response: ChatResponse) => void,
  onError: (error: Error) => void,
  signal?: AbortSignal,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/v1/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  } catch (err) {
    onError(err instanceof Error ? err : new Error(String(err)));
    return;
  }

  if (!response.ok || !response.body) {
    onError(new Error(`Stream request failed: ${response.status}`));
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      // Keep the last potentially incomplete line in the buffer
      buffer = lines.pop() ?? '';

      let currentEventType = '';
      for (const line of lines) {
        if (line.startsWith('event: ')) {
          currentEventType = line.slice(7).trim();
        } else if (line.startsWith('data: ')) {
          const jsonStr = line.slice(6);
          try {
            const parsed = JSON.parse(jsonStr) as StreamEvent;
            if (parsed.type === 'token' || currentEventType === 'token') {
              onToken((parsed as { content: string }).content ?? '');
              await sleep(20);
            } else if (parsed.type === 'envelope' || currentEventType === 'envelope') {
              onDone((parsed as { data: ChatResponse }).data);
            } else if (parsed.type === 'error' || currentEventType === 'error') {
              onError(new Error((parsed as { message: string }).message ?? 'Stream error'));
              return;
            }
            // 'done' event is informational; envelope follows it
          } catch {
            // Skip unparseable lines
          }
        }
      }
    }
  } catch (err) {
    if ((err as DOMException)?.name === 'AbortError') return;
    onError(err instanceof Error ? err : new Error(String(err)));
  } finally {
    reader.releaseLock();
  }
}

// ─── Conversation history ────────────────────────────────────────────────────

async function fetchConversationHistory(
  conversationId: string,
  limit = 50,
): Promise<ConversationHistoryTurn[]> {
  const response = await fetch(
    `${API_BASE_URL}/v1/conversations/${encodeURIComponent(conversationId)}/history?limit=${limit}`,
  );
  if (!response.ok) throw new Error('Failed to fetch conversation history');
  return response.json();
}

export function useConversationHistory(conversationId: string | null) {
  return useQuery({
    queryKey: ['conversation-history', conversationId],
    queryFn: () => fetchConversationHistory(conversationId!),
    enabled: !!conversationId,
    staleTime: Infinity, // history doesn't change from other sources
    retry: false,
  });
}

// ─── Workflow events (proposal approval) ────────────────────────────────────

interface WorkflowEventRequest {
  event_type: 'submit_review' | 'provide_clarification' | 'cancel';
  decision?: 'approve' | 'approve_with_edits' | 'reject';
  edits?: Record<string, unknown> | null;
  clarification_response?: string | null;
}

async function submitWorkflowEvent(
  workflowId: string,
  event: WorkflowEventRequest,
): Promise<ChatResponse> {
  const response = await fetch(`${API_BASE_URL}/v1/workflows/${workflowId}/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(event),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Workflow event failed: ${error}`);
  }
  return response.json();
}

export function useSubmitWorkflowEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ workflowId, event }: { workflowId: string; event: WorkflowEventRequest }) =>
      submitWorkflowEvent(workflowId, event),
    onSuccess: () => {
      // Pantry may have changed after approval
      queryClient.invalidateQueries({ queryKey: ['pantry'] });
    },
  });
}

// ─── Recent Activity (derived from pantry) ────────────────────────────────────

async function fetchRecentActivity(limit: number = 5): Promise<PantryItem[]> {
  // Fetch all items and sort client-side by added_at descending, then slice
  const data = await fetchPantryItems();
  return [...data.items]
    .sort((a, b) => new Date(b.added_at).getTime() - new Date(a.added_at).getTime())
    .slice(0, limit);
}

export function useRecentActivity(limit: number = 5) {
  return useQuery({
    queryKey: ['pantry', 'recent-activity', limit],
    queryFn: () => fetchRecentActivity(limit),
    staleTime: 1000 * 60, // 1 minute
  });
}

// ─── Kitchen Decorations ──────────────────────────────────────────────────────

async function fetchDecorations(): Promise<Decoration[]> {
  const response = await fetch(`${API_BASE_URL}/decorations`);
  if (!response.ok) throw new Error('Failed to fetch decorations');
  return response.json();
}

export function useDecorations() {
  return useQuery<Decoration[]>({
    queryKey: ['decorations'],
    queryFn: fetchDecorations,
    staleTime: 30_000,
  });
}

// ─── Kitchen Slot Persistence ─────────────────────────────────────────────────

export async function updateSlotIndex(
  itemId: string,
  slotIndex: number,
): Promise<void> {
  await fetch(`${API_BASE_URL}/pantry/${itemId}/slot?slot_index=${slotIndex}`, {
    method: 'PATCH',
  });
}

export async function updateItemLocation(
  itemId: string,
  storageLocation: string,
): Promise<void> {
  await fetch(`${API_BASE_URL}/pantry/${itemId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ storage_location: storageLocation }),
  });
}

// ─── AI Health ────────────────────────────────────────────────────────────────

async function fetchAIHealth(): Promise<{ ai_available: boolean; ai_providers: { name: string; available: boolean }[] }> {
  const res = await fetch(`${API_BASE_URL}/health/ai`);
  if (!res.ok) throw new Error('Health check failed');
  return res.json();
}

export function useAIHealth() {
  return useQuery({
    queryKey: ['health', 'ai'],
    queryFn: fetchAIHealth,
    staleTime: 1000 * 30, // 30 seconds
    retry: false,
  });
}

// ─── Recipe Library API ───────────────────────────────────────────────────────

async function fetchRecipeLibrary(params?: {
  search?: string;
  cuisine?: string;
  meal_type?: string;
  limit?: number;
  offset?: number;
}): Promise<RecipeLibraryItem[]> {
  const sp = new URLSearchParams();
  if (params?.search) sp.append('search', params.search);
  if (params?.cuisine) sp.append('cuisine', params.cuisine);
  if (params?.meal_type) sp.append('meal_type', params.meal_type);
  if (params?.limit != null) sp.append('limit', String(params.limit));
  if (params?.offset != null) sp.append('offset', String(params.offset));
  const url = `${API_BASE_URL}/recipes${sp.toString() ? `?${sp}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch recipe library');
  return res.json();
}

async function fetchRecipeDetail(id: string): Promise<RecipeDetailType> {
  const res = await fetch(`${API_BASE_URL}/recipes/${id}`);
  if (!res.ok) throw new Error('Failed to fetch recipe');
  return res.json();
}

export async function saveRecipeToLibrary(recipe: SaveRecipeRequest): Promise<RecipeLibraryItem> {
  const res = await fetch(`${API_BASE_URL}/recipes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(recipe),
  });
  if (!res.ok) throw new Error('Failed to save recipe');
  return res.json();
}

async function updateRecipeInLibrary(id: string, data: Partial<SaveRecipeRequest>): Promise<RecipeDetailType> {
  const res = await fetch(`${API_BASE_URL}/recipes/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update recipe');
  return res.json();
}

async function deleteRecipeFromLibrary(id: string): Promise<void> {
  const res = await fetch(`${API_BASE_URL}/recipes/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete recipe');
}

export async function refineRecipe(id: string, prompt: string): Promise<RecipeDetailType> {
  const res = await fetch(`${API_BASE_URL}/recipes/${id}/refine`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instruction: prompt }),
  });
  if (!res.ok) throw new Error('Failed to refine recipe');
  return res.json();
}

export function useRecipes(params?: {
  search?: string;
  cuisine?: string;
  meal_type?: string;
  limit?: number;
  offset?: number;
}) {
  return useQuery({
    queryKey: ['recipes', params],
    queryFn: () => fetchRecipeLibrary(params),
    staleTime: 1000 * 60,
    placeholderData: (prev) => prev,
  });
}

export function useRecipe(id: string | null) {
  return useQuery({
    queryKey: ['recipes', id],
    queryFn: () => fetchRecipeDetail(id!),
    enabled: id != null,
  });
}

export function useSaveRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: saveRecipeToLibrary,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recipes'] }),
  });
}

export function useUpdateRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<SaveRecipeRequest> }) =>
      updateRecipeInLibrary(id, data),
    onSuccess: (_result, { id }) => {
      qc.invalidateQueries({ queryKey: ['recipes', id] });
      qc.invalidateQueries({ queryKey: ['recipes'] });
    },
  });
}

export function useDeleteRecipe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteRecipeFromLibrary,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recipes'] }),
  });
}

export function useRefineRecipe() {
  return useMutation({
    mutationFn: ({ id, prompt }: { id: string; prompt: string }) => refineRecipe(id, prompt),
  });
}
