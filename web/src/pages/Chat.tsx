import { useState, useRef, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Send,
  ChefHat,
  Loader2,
  AlertTriangle,
  MessageCircle,
  Sparkles,
  BookOpen,
  Clock,
  Users,
  RefreshCw,
} from 'lucide-react';
import { useChat, useAIHealth, useModeSuggestions, useConversationHistory, useSubmitWorkflowEvent } from '../api/client';
import type {
  ChatMessage,
  ChatResponse,
  PantryProposalData,
  ChatRecipeData,
  ChatMode,
} from '../types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function generateConversationId(): string {
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

// ─── Mode config ──────────────────────────────────────────────────────────────

const MODE_CONFIG: Record<ChatMode, {
  label: string;
  icon: typeof MessageCircle;
  title: string;
  subtitle: string;
  placeholder: string;
  emptyTitle: string;
  emptyDescription: string;
}> = {
  chat: {
    label: 'Chat',
    icon: MessageCircle,
    title: 'Chat with BubblyChef',
    subtitle: 'Your AI kitchen assistant',
    placeholder: 'Ask me anything about your kitchen\u2026',
    emptyTitle: "Hi! I'm your kitchen assistant",
    emptyDescription: 'Ask me about recipes, add groceries, or get cooking tips!',
  },
  recipe: {
    label: 'Recipe',
    icon: Sparkles,
    title: 'Recipe Magic',
    subtitle: 'Tell me what you want to cook!',
    placeholder: 'What would you like to make?',
    emptyTitle: 'Ready to cook?',
    emptyDescription: "Tell me what you'd like to make and I'll create a recipe from your pantry!",
  },
  learn: {
    label: 'Learn',
    icon: BookOpen,
    title: 'Learn to Cook',
    subtitle: 'Level up your kitchen skills',
    placeholder: 'Ask me about cooking techniques\u2026',
    emptyTitle: 'Kitchen school is in session',
    emptyDescription: 'Ask about techniques, substitutions, food science, and more!',
  },
};

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: 'bg-pastel-mint text-soft-charcoal',
  medium: 'bg-pastel-peach text-soft-charcoal',
  hard: 'bg-pastel-coral text-white',
};

// ─── Mode selector ────────────────────────────────────────────────────────────

function ModeSelector({ mode, onChange }: { mode: ChatMode; onChange: (m: ChatMode) => void }) {
  const modes: ChatMode[] = ['chat', 'recipe', 'learn'];

  return (
    <div className="flex gap-1 bg-soft-charcoal/5 rounded-full p-1">
      {modes.map((m) => {
        const config = MODE_CONFIG[m];
        const Icon = config.icon;
        const isActive = m === mode;
        return (
          <button
            key={m}
            onClick={() => onChange(m)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${
              isActive
                ? 'bg-white shadow-soft text-soft-charcoal'
                : 'text-soft-charcoal/50 hover:text-soft-charcoal/70'
            }`}
          >
            <Icon size={14} strokeWidth={isActive ? 2.5 : 2} />
            {config.label}
          </button>
        );
      })}
    </div>
  );
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
        <p className="text-soft-charcoal font-semibold">Added to pantry!</p>
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
        Proposed pantry update ({actions.length} item{actions.length !== 1 ? 's' : ''})
      </p>
      <div className="space-y-2">
        {actions.map((action, i) => (
          <div
            key={i}
            className="flex items-center justify-between bg-white/70 rounded-xl px-3 py-2"
          >
            <div className="flex items-center gap-2">
              <span className="text-base">
                {action.action_type === 'add' ? '+' :
                  action.action_type === 'remove' ? '-' :
                  action.action_type === 'use' ? '~' : '*'}
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
          Approve
        </button>
        <button
          onClick={onReject}
          className="flex-1 py-2 rounded-full bg-white border border-pastel-coral/40 text-soft-charcoal/70 text-sm font-semibold hover:bg-pastel-coral/10 active:scale-95 transition-all"
        >
          Skip
        </button>
      </div>
    </div>
  );
}

/** Compact recipe card — shown in chat/learn modes */
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
            {recipe.title ?? 'Recipe'}
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
          <span>{totalTime} min</span>
        )}
        {recipe.servings != null && (
          <span>{recipe.servings} servings</span>
        )}
        {recipe.cuisine && (
          <span>{recipe.cuisine}</span>
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

/** Full recipe card — shown in recipe mode with instructions, ingredients, tips */
function FullRecipeCard({ recipe, onTryAnother }: {
  recipe: ChatRecipeData;
  onTryAnother: () => void;
}) {
  const computedTime =
    (recipe.prep_time_minutes ?? 0) + (recipe.cook_time_minutes ?? 0);
  const totalTime = recipe.total_time_minutes ?? (computedTime > 0 ? computedTime : null);
  const ingredients = recipe.ingredients ?? [];
  const instructions = recipe.instructions ?? [];

  return (
    <div className="mt-3 space-y-3">
      {/* Recipe header */}
      <div className="rounded-2xl bg-white shadow-soft overflow-hidden">
        <div className="p-4 bg-gradient-to-r from-pastel-pink/20 to-pastel-lavender/20">
          <h2 className="text-xl font-bold text-soft-charcoal">{recipe.title ?? 'Recipe'}</h2>
          {recipe.description && (
            <p className="text-soft-charcoal/60 text-sm mt-1">{recipe.description}</p>
          )}

          <div className="flex flex-wrap gap-3 mt-3">
            {totalTime != null && totalTime > 0 && (
              <div className="flex items-center gap-1 text-sm text-soft-charcoal/70">
                <Clock size={16} />
                <span>{totalTime} min</span>
              </div>
            )}
            {recipe.servings != null && (
              <div className="flex items-center gap-1 text-sm text-soft-charcoal/70">
                <Users size={16} />
                <span>{recipe.servings} servings</span>
              </div>
            )}
            {recipe.difficulty && (
              <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${DIFFICULTY_COLORS[recipe.difficulty] || 'bg-gray-100'}`}>
                {recipe.difficulty}
              </span>
            )}
            {recipe.cuisine && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-pastel-lavender/20 text-pastel-lavender">
                {recipe.cuisine}
              </span>
            )}
          </div>
        </div>

        {/* Ingredients */}
        {ingredients.length > 0 && (
          <div className="p-4 border-b border-gray-100">
            <h3 className="font-bold text-soft-charcoal mb-3">Ingredients</h3>
            <div className="space-y-2">
              {ingredients.map((ing, i) => (
                <div key={i} className="flex items-start gap-2 text-sm">
                  <span className="text-pastel-pink mt-0.5">•</span>
                  <span className="text-soft-charcoal">
                    {ing.quantity != null && ing.unit ? `${ing.quantity} ${ing.unit} ` : ''}
                    <span className="font-medium">{ing.name}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Instructions */}
        {instructions.length > 0 && (
          <div className="p-4 border-b border-gray-100">
            <h3 className="font-bold text-soft-charcoal mb-3">Instructions</h3>
            <ol className="space-y-3">
              {instructions.map((step, i) => (
                <li key={i} className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-pastel-pink text-white text-sm font-bold flex items-center justify-center">
                    {i + 1}
                  </span>
                  <p className="text-sm text-soft-charcoal leading-relaxed pt-0.5">{step}</p>
                </li>
              ))}
            </ol>
          </div>
        )}

        {/* Dietary tags as tips */}
        {recipe.dietary_tags && recipe.dietary_tags.length > 0 && (
          <div className="p-4 bg-pastel-peach/10">
            <h3 className="font-bold text-soft-charcoal mb-2">Tags</h3>
            <div className="flex flex-wrap gap-1">
              {recipe.dietary_tags.map((tag, i) => (
                <span
                  key={i}
                  className="px-2 py-0.5 rounded-full bg-pastel-mint/30 text-xs text-soft-charcoal"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Try another button */}
      <button
        onClick={onTryAnother}
        className="w-full py-3 rounded-full bg-white border border-pastel-lavender/30 text-pastel-lavender font-semibold shadow-soft hover:shadow-soft-lg transition-all active:scale-95 flex items-center justify-center gap-2"
      >
        <RefreshCw size={18} />
        Try Another Recipe
      </button>

      <p className="text-center text-xs text-soft-charcoal/40">
        Type a follow-up like "make it spicier" or "substitute for eggs"
      </p>
    </div>
  );
}

// ─── Message bubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg, mode, onProposalApprove, onProposalReject, onTryAnother, proposalState }: {
  msg: ChatMessage;
  mode: ChatMode;
  onProposalApprove: (msgId: string) => void;
  onProposalReject: (msgId: string) => void;
  onTryAnother: () => void;
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
      if (mode === 'recipe') {
        return (
          <FullRecipeCard
            recipe={proposal as ChatRecipeData}
            onTryAnother={onTryAnother}
          />
        );
      }
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

function EmptyState({ mode, suggestions, onSuggestion }: {
  mode: ChatMode;
  suggestions: string[];
  onSuggestion: (text: string) => void;
}) {
  const config = MODE_CONFIG[mode];

  return (
    <div className="flex flex-col items-center justify-center h-full py-12 px-4 text-center">
      <div className="w-16 h-16 rounded-full bg-pastel-pink/20 flex items-center justify-center mb-4">
        <ChefHat size={32} className="text-pastel-pink" />
      </div>
      <h2 className="text-xl font-bold text-soft-charcoal mb-2">
        {config.emptyTitle}
      </h2>
      <p className="text-soft-charcoal/60 text-sm mb-6 max-w-xs">
        {config.emptyDescription}
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-sm">
        {suggestions.map((s) => (
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

function isValidMode(value: string | null): value is ChatMode {
  return value === 'chat' || value === 'recipe' || value === 'learn';
}

export function Chat() {
  const [searchParams, setSearchParams] = useSearchParams();
  const initialMode = isValidMode(searchParams.get('mode')) ? searchParams.get('mode') as ChatMode : 'chat';

  const [mode, setMode] = useState<ChatMode>(initialMode);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  // Stable conversation ID for this session — changes only on mode change
  const [conversationId, setConversationId] = useState<string>(() => generateConversationId());
  const [proposalState, setProposalState] = useState<Record<string, boolean | null>>({});
  // Track workflow_id per message so we can call the approve endpoint
  const [messageWorkflowIds, setMessageWorkflowIds] = useState<Record<string, string>>({});
  const historyLoaded = useRef(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { mutate: sendChat, isPending } = useChat();
  const { mutate: submitWorkflowEvent } = useSubmitWorkflowEvent();
  const { data: aiHealth } = useAIHealth();
  const aiUnavailable = aiHealth !== undefined && !aiHealth.ai_available;
  const { data: suggestions } = useModeSuggestions(mode);

  // Load prior conversation history on first mount
  const { data: storedHistory } = useConversationHistory(conversationId);
  useEffect(() => {
    if (historyLoaded.current || !storedHistory || storedHistory.length === 0) return;
    historyLoaded.current = true;
    const restored: ChatMessage[] = storedHistory.map((turn) => ({
      id: generateId(),
      role: turn.role,
      content: turn.content,
      intent: turn.intent as ChatMessage['intent'],
      timestamp: new Date(turn.created_at),
    }));
    setMessages(restored);
  }, [storedHistory]);

  const config = MODE_CONFIG[mode];

  const handleModeChange = useCallback((newMode: ChatMode) => {
    setMode(newMode);
    setMessages([]);
    setConversationId(generateConversationId());
    setProposalState({});
    setMessageWorkflowIds({});
    setInput('');
    historyLoaded.current = false;
    setSearchParams({ mode: newMode }, { replace: true });
  }, [setSearchParams]);

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
      { message: messageText, conversation_id: conversationId, mode },
      {
        onSuccess: (response: ChatResponse) => {
          let content = response.assistant_message || '';

          if (
            response.intent === 'recipe_ingest_request' ||
            (response.intent === 'general_chat' &&
              messageText.toLowerCase().includes('saved recipe'))
          ) {
            content =
              "Recipe library coming in Phase 3! For now, try asking me to generate a recipe.";
          }

          if (!content) {
            content = "I'm not sure how to help with that. Try asking about recipes or groceries!";
          }

          const assistantMsgId = generateId();
          const assistantMsg: ChatMessage = {
            id: assistantMsgId,
            role: 'assistant',
            content,
            intent: response.intent,
            timestamp: new Date(),
            response,
          };
          setMessages((prev) => [...prev, assistantMsg]);
          // Store workflow_id so approval can call the right endpoint
          if (response.workflow_id && response.requires_review) {
            setMessageWorkflowIds((prev) => ({ ...prev, [assistantMsgId]: response.workflow_id }));
          }
        },
        onError: (err: Error) => {
          const errorMsg: ChatMessage = {
            id: generateId(),
            role: 'assistant',
            content: `Oops! Something went wrong (${err.message}). Please try again!`,
            timestamp: new Date(),
          };
          setMessages((prev) => [...prev, errorMsg]);
        },
      }
    );
  }, [input, isPending, sendChat, conversationId, mode]);

  const handleTryAnother = useCallback(() => {
    handleSend('Give me a different recipe');
  }, [handleSend]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleProposalApprove = useCallback((msgId: string) => {
    const workflowId = messageWorkflowIds[msgId];
    if (workflowId) {
      submitWorkflowEvent(
        { workflowId, event: { event_type: 'submit_review', decision: 'approve' } },
        {
          onSuccess: () => setProposalState((prev) => ({ ...prev, [msgId]: true })),
          onError: () => setProposalState((prev) => ({ ...prev, [msgId]: true })), // still mark as done in UI
        },
      );
    } else {
      // No workflow ID (e.g. restored from history) — just update UI state
      setProposalState((prev) => ({ ...prev, [msgId]: true }));
    }
  }, [messageWorkflowIds, submitWorkflowEvent]);

  const handleProposalReject = useCallback((msgId: string) => {
    const workflowId = messageWorkflowIds[msgId];
    if (workflowId) {
      submitWorkflowEvent(
        { workflowId, event: { event_type: 'submit_review', decision: 'reject' } },
        {
          onSettled: () => setProposalState((prev) => ({ ...prev, [msgId]: false })),
        },
      );
    } else {
      setProposalState((prev) => ({ ...prev, [msgId]: false }));
    }
  }, [messageWorkflowIds, submitWorkflowEvent]);

  return (
    <div className="flex flex-col h-[calc(100vh-5rem)] lg:h-screen">
      {/* Header */}
      <div className="px-4 pt-6 pb-3 lg:px-8 lg:pt-8 border-b border-pastel-pink/10 bg-cream/80 backdrop-blur-sm shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ChefHat className="text-pastel-pink" size={24} strokeWidth={2.5} />
            <h1 className="text-xl font-bold text-soft-charcoal">{config.title}</h1>
          </div>
        </div>
        <div className="flex items-center justify-between mt-2">
          <p className="text-xs text-soft-charcoal/50">
            {config.subtitle}
          </p>
          <ModeSelector mode={mode} onChange={handleModeChange} />
        </div>
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
          <EmptyState
            mode={mode}
            suggestions={suggestions ?? []}
            onSuggestion={(s) => handleSend(s)}
          />
        ) : (
          <>
            {messages.map((msg) => (
              <MessageBubble
                key={msg.id}
                msg={msg}
                mode={mode}
                onProposalApprove={handleProposalApprove}
                onProposalReject={handleProposalReject}
                onTryAnother={handleTryAnother}
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
            placeholder={config.placeholder}
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
