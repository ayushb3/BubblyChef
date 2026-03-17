import { useState, useRef, useEffect, useCallback } from 'react';
import { Send, ChefHat, Loader2, AlertTriangle } from 'lucide-react';
import { useChat, useAIHealth } from '../api/client';
import type {
  ChatMessage,
  ChatResponse,
  PantryProposalData,
  ChatRecipeData,
} from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function generateConversationId(): string {
  // Simple UUID v4-like string
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function formatRelativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

// ─── Intent-specific rendering ────────────────────────────────────────────────

function PantryProposalCard({ proposal, onApprove, onReject, approved }: {
  proposal: PantryProposalData;
  onApprove: () => void;
  onReject: () => void;
  approved: boolean | null;
}) {
  if (approved === true) {
    return (
      <div className="mt-3 rounded-2xl bg-pastel-mint/30 border border-pastel-mint/50 p-4 text-center">
        <p className="text-soft-charcoal font-semibold">✅ Added to pantry!</p>
      </div>
    );
  }
  if (approved === false) {
    return (
      <div className="mt-3 rounded-2xl bg-pastel-coral/20 border border-pastel-coral/30 p-4 text-center">
        <p className="text-soft-charcoal/70 text-sm">Skipped — no changes made.</p>
      </div>
    );
  }

  const actions = proposal.actions ?? [];

  return (
    <div className="mt-3 rounded-2xl bg-pastel-lavender/20 border border-pastel-lavender/40 p-4 space-y-3">
      <p className="text-sm font-bold text-soft-charcoal">
        🛒 Proposed pantry update ({actions.length} item{actions.length !== 1 ? 's' : ''})
      </p>
      <div className="space-y-2">
        {actions.map((action, i) => (
          <div
            key={i}
            className="flex items-center justify-between bg-white/70 rounded-xl px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span className="text-base">
                {action.action_type === 'add' ? '➕' :
                  action.action_type === 'remove' ? '➖' :
                  action.action_type === 'use' ? '🍽️' : '✏️'}
              </span>
              <div>
                <p className="text-sm font-semibold text-soft-charcoal capitalize">
                  {action.item.name}
                </p>
                {action.item.quantity != null && (
                  <p className="text-xs text-soft-charcoal/60">
                    {action.item.quantity} {action.item.unit ?? 'item'}
                  </p>
                )}
              </div>
            </div>
            <span className="text-xs text-soft-charcoal/50 capitalize">
              {action.action_type}
            </span>
          </div>
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        <button
          onClick={onApprove}
          className="flex-1 py-2 rounded-full bg-pastel-mint text-soft-charcoal text-sm font-bold hover:opacity-90 active:scale-95 transition-all"
        >
          ✓ Approve
        </button>
        <button
          onClick={onReject}
          className="flex-1 py-2 rounded-full bg-white border border-pastel-coral/40 text-soft-charcoal/70 text-sm font-semibold hover:bg-pastel-coral/10 active:scale-95 transition-all"
        >
          ✕ Skip
        </button>
      </div>
    </div>
  );
}

function RecipeCard({ recipe }: { recipe: ChatRecipeData }) {
  const topIngredients = (recipe.ingredients ?? []).slice(0, 3);
  const computedTime =
    (recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0);
  const totalTime = recipe.total_time_minutes ?? (computedTime > 0 ? computedTime : null);

  return (
    <div className="mt-3 rounded-2xl bg-pastel-peach/30 border border-pastel-peach/60 p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-bold text-soft-charcoal text-base">
            🍽️ {recipe.title ?? 'Recipe'}
          </p>
          {recipe.description && (
            <p className="text-xs text-soft-charcoal/60 mt-1 line-clamp-2">
              {recipe.description}
            </p>
          )}
        </div>
        {recipe.difficulty && (
          <span className="px-2 py-1 rounded-full bg-pastel-peach text-soft-charcoal text-xs font-semibold shrink-0 capitalize">
            {recipe.difficulty}
          </span>
        )}
      </div>

      <div className="flex gap-3 text-xs text-soft-charcoal/70">
        {totalTime != null && totalTime > 0 && (
          <span>⏱️ {totalTime} min</span>
        )}
        {recipe.servings != null && (
          <span>🍴 {recipe.servings} servings</span>
        )}
        {recipe.cuisine && (
          <span>🌍 {recipe.cuisine}</span>
        )}
      </div>

      {topIngredients.length > 0 && (
        <div>
          <p className="text-xs font-bold text-soft-charcoal/60 mb-1 uppercase tracking-wide">
            Key ingredients
          </p>
          <div className="flex flex-wrap gap-1">
            {topIngredients.map((ing, i) => (
              <span
                key={i}
                className="px-2 py-0.5 rounded-full bg-white/80 border border-pastel-peach/40 text-xs text-soft-charcoal"
              >
                {ing.name}
                {ing.quantity != null ? ` · ${ing.quantity}${ing.unit ? ' ' + ing.unit : ''}` : ''}
              </span>
            ))}
            {(recipe.ingredients ?? []).length > 3 && (
              <span className="px-2 py-0.5 rounded-full bg-white/60 text-xs text-soft-charcoal/50">
                +{(recipe.ingredients ?? []).length - 3} more
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg, onProposalApprove, onProposalReject, proposalState }: {
  msg: ChatMessage;
  onProposalApprove: (msgId: string) => void;
  onProposalReject: (msgId: string) => void;
  proposalState: Record<string, boolean | null>;
}) {
  const isUser = msg.role === 'user';

  const renderProposal = () => {
    if (!msg.response) return null;
    const { intent, proposal } = msg.response;
    const approved = proposalState[msg.id] ?? null;

    if (intent === 'pantry_update' && proposal) {
      return (
        <PantryProposalCard
          proposal={proposal as PantryProposalData}
          onApprove={() => onProposalApprove(msg.id)}
          onReject={() => onProposalReject(msg.id)}
          approved={approved}
        />
      );
    }

    if (intent === 'recipe_card' && proposal) {
      return <RecipeCard recipe={proposal as ChatRecipeData} />;
    }

    return null;
  };

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      {!isUser && (
        <div className="w-8 h-8 rounded-full bg-pastel-pink/30 flex items-center justify-center mr-2 shrink-0 mt-1">
          <ChefHat size={16} className="text-pastel-pink" />
        </div>
      )}
      <div className={`max-w-[80%] ${isUser ? 'items-end' : 'items-start'} flex flex-col`}>
        <div
          className={`px-4 py-3 rounded-2xl text-sm leading-relaxed ${
            isUser
              ? 'bg-pastel-pink text-soft-charcoal rounded-tr-md'
              : 'bg-white shadow-soft text-soft-charcoal rounded-tl-md'
          }`}
        >
          {msg.content}
        </div>

        {renderProposal()}

        <span className="text-xs text-soft-charcoal/40 mt-1 px-1">
          {formatRelativeTime(msg.timestamp)}
        </span>
      </div>
    </div>
  );
}

// ─── Empty state ───────────────────────────────────────────────────────────────

const SUGGESTIONS = [
  "What can I make with what I have?",
  "I just bought milk, eggs, and cheese",
  "How long does cooked chicken last?",
  "Make me a quick pasta recipe",
];

function EmptyState({ onSuggestion }: { onSuggestion: (text: string) => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full py-12 px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-pastel-pink/20 flex items-center justify-center mb-4">
        <ChefHat size={32} className="text-pastel-pink" />
      </div>
      <h2 className="text-xl font-bold text-soft-charcoal mb-2">
        Hi! I'm your kitchen assistant 🍳
      </h2>
      <p className="text-soft-charcoal/60 text-sm mb-6 max-w-xs">
        Ask me about recipes, add groceries, or get cooking tips!
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-sm">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => onSuggestion(s)}
            className="text-left px-4 py-3 bg-white rounded-2xl text-sm text-soft-charcoal/80 shadow-soft hover:shadow-soft-lg hover:bg-pastel-pink/10 active:scale-95 transition-all border border-pastel-pink/10"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Chat page ────────────────────────────────────────────────────────────────

export function Chat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [conversationId] = useState<string>(() => generateConversationId());
  const [proposalState, setProposalState] = useState<Record<string, boolean | null>>({});

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { mutate: sendChat, isPending } = useChat();
  const { data: aiHealth } = useAIHealth();
  const aiUnavailable = aiHealth !== undefined && !aiHealth.ai_available;

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleSend = useCallback((text?: string) => {
    const messageText = (text ?? input).trim();
    if (!messageText || isPending) return;

    const userMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: messageText,
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInput('');

    sendChat(
      { message: messageText, conversation_id: conversationId },
      {
        onSuccess: (response: ChatResponse) => {
          // Determine display text for saved-recipe-lookup
          let content = response.assistant_message || '';

          if (
            response.intent === 'recipe_ingest_request' ||
            (response.intent === 'general_chat' &&
              messageText.toLowerCase().includes('saved recipe'))
          ) {
            content =
              "Recipe library coming in Phase 3! For now, try asking me to generate a recipe 🍳";
          }

          if (!content) {
            content = "I'm not sure how to help with that. Try asking about recipes or groceries!";
          }

          const assistantMsg: ChatMessage = {
            id: generateId(),
            role: 'assistant',
            content,
            intent: response.intent,
            timestamp: new Date(),
            response,
          };
          setMessages((prev) => [...prev, assistantMsg]);
        },
        onError: (err: Error) => {
          const errorMsg: ChatMessage = {
            id: generateId(),
            role: 'assistant',
            content: `Oops! Something went wrong 😅 (${err.message}). Please try again!`,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, errorMsg]);
        },
      }
    );
  }, [input, isPending, sendChat, conversationId]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleProposalApprove = (msgId: string) => {
    setProposalState((prev) => ({ ...prev, [msgId]: true }));
  };

  const handleProposalReject = (msgId: string) => {
    setProposalState((prev) => ({ ...prev, [msgId]: false }));
  };

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] lg:h-screen">
      {/* Header */}
      <div className="px-4 pt-6 pb-3 lg:px-8 lg:pt-8 border-b border-pastel-pink/10 bg-cream/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center gap-2">
          <ChefHat className="text-pastel-pink" size={24} strokeWidth={2.5} />
          <h1 className="text-xl font-bold text-soft-charcoal">Chat with BubblyChef</h1>
        </div>
        <p className="text-xs text-soft-charcoal/50 mt-0.5">
          Your AI kitchen assistant ✨
        </p>
      </div>

      {/* AI unavailable warning */}
      {aiUnavailable && (
        <div className="mx-4 mt-3 lg:mx-8 flex items-start gap-2 px-4 py-3 bg-pastel-peach/40 border border-pastel-peach rounded-2xl text-sm text-soft-charcoal shrink-0">
          <AlertTriangle size={16} className="text-pastel-coral mt-0.5 shrink-0" />
          <span>
            No AI provider is available. Check that your <strong>BUBBLY_GEMINI_API_KEY</strong> is set, or start Ollama locally.
          </span>
        </div>
      )}

      {/* Message thread */}
      <div className="flex-1 overflow-y-auto px-4 pt-4 lg:px-8">
        {messages.length === 0 ? (
          <EmptyState onSuggestion={(s) => handleSend(s)} />
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                onProposalApprove={handleProposalApprove}
                onProposalReject={handleProposalReject}
                proposalState={proposalState}
              />
            ))}

            {/* Loading indicator */}
            {isPending && (
              <div className="flex justify-start mb-4">
                <div className="w-8 h-8 rounded-full bg-pastel-pink/30 flex items-center justify-center mr-2 shrink-0">
                  <ChefHat size={16} className="text-pastel-pink" />
                </div>
                <div className="bg-white shadow-soft px-4 py-3 rounded-2xl rounded-tl-md">
                  <Loader2 size={16} className="text-pastel-pink animate-spin" />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input bar */}
      <div className="shrink-0 px-4 py-3 lg:px-8 lg:py-4 bg-white/95 backdrop-blur-sm border-t border-pastel-pink/10">
        <div className="flex items-end gap-2 bg-cream rounded-2xl px-4 py-2 border border-pastel-pink/20 shadow-soft">
          <textarea
            ref={inputRef}
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask me anything about your kitchen…"
            disabled={isPending}
            className="flex-1 bg-transparent text-sm text-soft-charcoal placeholder-soft-charcoal/40 resize-none outline-none leading-relaxed max-h-32 disabled:opacity-50"
            style={{ minHeight: '24px' }}
          />
          <button
            onClick={() => handleSend()}
            disabled={!input.trim() || isPending}
            className="p-2 rounded-full bg-pastel-pink text-soft-charcoal disabled:opacity-40 hover:opacity-90 active:scale-95 transition-all shrink-0 mb-0.5"
            aria-label="Send message"
          >
            {isPending ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Send size={16} strokeWidth={2.5} />
            )}
          </button>
        </div>
        <p className="text-center text-xs text-soft-charcoal/30 mt-1.5">
          Press Enter to send · Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
