import { useState, useRef } from 'react';
import { Camera, Upload, CheckCircle, AlertCircle, X, Loader2, RotateCcw } from 'lucide-react';
import {
  useUploadReceipt,
  useConfirmScanItems,
  useOcrStatus,
} from '../api/client';

type ScanState = 'upload' | 'processing' | 'results' | 'success';

const UNIT_OPTIONS = [
  'item', 'count', 'lb', 'oz', 'kg', 'g',
  'dozen', 'bunch', 'gallon', 'quart', 'pint', 'fl oz', 'liter', 'ml',
  'package', 'bag', 'box', 'can', 'jar', 'bottle', 'container',
  'loaf', 'slice', 'cup', 'tbsp', 'tsp',
];

const LOCATION_OPTIONS: { value: string; label: string; emoji: string }[] = [
  { value: 'fridge',  label: 'Fridge',  emoji: '🧊' },
  { value: 'freezer', label: 'Freezer', emoji: '❄️' },
  { value: 'pantry',  label: 'Pantry',  emoji: '🏠' },
  { value: 'counter', label: 'Counter', emoji: '🍎' },
];

interface ScannedItem {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  confidence: 'high' | 'medium' | 'low';
  rawText?: string;
  expiryDate: string | null;
  location: string;
  category: string;
}

type ItemRefs = {
  name: HTMLInputElement | null;
  quantity: HTMLInputElement | null;
  unit: HTMLSelectElement | null;
  expiry: HTMLInputElement | null;
  location: HTMLSelectElement | null;
};

export function Scan() {
  const [scanState, setScanState] = useState<ScanState>('upload');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [readyToAddItems, setReadyToAddItems] = useState<ScannedItem[]>([]);
  const [needsReviewItems, setNeedsReviewItems] = useState<ScannedItem[]>([]);
  const [skippedItems, setSkippedItems] = useState<ScannedItem[]>([]);
  const [dismissedItems, setDismissedItems] = useState<ScannedItem[]>([]);
  const [failedItems, setFailedItems] = useState<string[]>([]);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [addedCount, setAddedCount] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const needsReviewRefs = useRef<Map<string, ItemRefs>>(new Map());
  const readyToAddRefs = useRef<Map<string, ItemRefs>>(new Map());

  // API hooks
  const uploadMutation = useUploadReceipt();
  const confirmMutation = useConfirmScanItems();
  const { data: ocrStatus } = useOcrStatus();

  const processFile = async (file: File) => {
    setErrorMessage(null);
    setWarnings([]);

    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    setScanState('processing');

    try {
      const result = await uploadMutation.mutateAsync(file);

      setRequestId(result.request_id);

      setReadyToAddItems(
        result.ready_to_add.map(item => ({
          id: item.temp_id,
          name: item.name,
          quantity: item.quantity || 1,
          unit: item.unit || 'item',
          confidence: 'high' as const,
          rawText: item.raw_text,
          expiryDate: item.expiry_date ?? null,
          location: item.location ?? 'pantry',
          category: item.category ?? 'other',
        }))
      );

      setNeedsReviewItems(
        result.needs_review.map(item => ({
          id: item.temp_id,
          name: item.name,
          quantity: item.quantity || 1,
          unit: item.unit || 'item',
          confidence: getConfidenceLevel(item.confidence),
          rawText: item.raw_text,
          expiryDate: item.expiry_date ?? null,
          location: item.location ?? 'pantry',
          category: item.category ?? 'other',
        }))
      );

      setSkippedItems(
        result.skipped.map(item => ({
          id: item.temp_id,
          name: item.name,
          quantity: item.quantity || 1,
          unit: item.unit || 'item',
          confidence: getConfidenceLevel(item.confidence),
          rawText: item.raw_text,
          expiryDate: item.expiry_date ?? null,
          location: item.location ?? 'pantry',
          category: item.category ?? 'other',
        }))
      );

      if (result.warnings.length > 0) {
        setWarnings(result.warnings);
      }

      setScanState('results');
    } catch (error) {
      console.error('Failed to process receipt:', error);
      setScanState('upload');
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Failed to process receipt. Please try again.'
      );
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      await processFile(file);
    }
  };

  const getConfidenceLevel = (confidence: number): 'high' | 'medium' | 'low' => {
    if (confidence >= 0.8) return 'high';
    if (confidence >= 0.6) return 'medium';
    return 'low';
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) {
      await processFile(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleReset = () => {
    setScanState('upload');
    setPreviewUrl(null);
    setReadyToAddItems([]);
    setNeedsReviewItems([]);
    setSkippedItems([]);
    setDismissedItems([]);
    setFailedItems([]);
    setRequestId(null);
    setWarnings([]);
    setErrorMessage(null);
    setShowCancelConfirm(false);
    setAddedCount(0);
    needsReviewRefs.current.clear();
    readyToAddRefs.current.clear();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Dismiss an item (moves to dismissed instead of deleting)
  const dismissItem = (item: ScannedItem, from: 'ready' | 'review') => {
    if (from === 'ready') {
      setReadyToAddItems(items => items.filter(i => i.id !== item.id));
      readyToAddRefs.current.delete(item.id);
    } else {
      setNeedsReviewItems(items => items.filter(i => i.id !== item.id));
      needsReviewRefs.current.delete(item.id);
    }
    setDismissedItems(prev => [...prev, item]);
  };

  // Restore a dismissed item back to needs-review
  const restoreItem = (item: ScannedItem) => {
    setDismissedItems(prev => prev.filter(i => i.id !== item.id));
    setNeedsReviewItems(prev => [...prev, { ...item, confidence: item.confidence }]);
  };

  const moveToReview = (id: string) => {
    const skipped = skippedItems.find(item => item.id === id);
    if (skipped) {
      setNeedsReviewItems(items => [...items, skipped]);
      setSkippedItems(items => items.filter(item => item.id !== id));
    }
  };

  const addSelectedItems = async () => {
    if (!requestId) {
      handleReset();
      return;
    }

    try {
      const allItemsToAdd = [];

      for (const item of readyToAddItems) {
        const refs = readyToAddRefs.current.get(item.id);
        allItemsToAdd.push({
          temp_id: item.id,
          name: refs?.name?.value || item.name,
          quantity: Number(refs?.quantity?.value || item.quantity),
          unit: refs?.unit?.value || item.unit,
          category: item.category,
          storage_location: refs?.location?.value || item.location,
          expiry_date: refs?.expiry?.value || item.expiryDate || undefined,
        });
      }

      for (const item of needsReviewItems) {
        const refs = needsReviewRefs.current.get(item.id);
        allItemsToAdd.push({
          temp_id: item.id,
          name: refs?.name?.value || item.name,
          quantity: Number(refs?.quantity?.value || item.quantity),
          unit: refs?.unit?.value || item.unit,
          category: item.category,
          storage_location: refs?.location?.value || item.location,
          expiry_date: refs?.expiry?.value || item.expiryDate || undefined,
        });
      }

      if (allItemsToAdd.length > 0) {
        const result = await confirmMutation.mutateAsync({
          requestId,
          items: allItemsToAdd,
        });

        if (result.failed.length > 0) {
          console.warn('Some items failed to add:', result.failed);
          setErrorMessage(
            `Added ${result.added.length} items, but ${result.failed.length} failed.`
          );
        }

        setAddedCount(result.added.length);
      }

      // Clear working state but show success screen
      setReadyToAddItems([]);
      setNeedsReviewItems([]);
      setSkippedItems([]);
      setDismissedItems([]);
      needsReviewRefs.current.clear();
      readyToAddRefs.current.clear();
      setScanState('success');
    } catch (error) {
      console.error('Failed to save items:', error);
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Failed to save items. Please try again.'
      );
    }
  };

  const getConfidenceBadge = (confidence: 'high' | 'medium' | 'low') => {
    switch (confidence) {
      case 'high':
        return 'bg-pastel-mint text-soft-charcoal';
      case 'medium':
        return 'bg-pastel-peach text-soft-charcoal';
      case 'low':
        return 'bg-pastel-coral/50 text-soft-charcoal';
    }
  };

  const getConfidenceText = (confidence: 'high' | 'medium' | 'low') => {
    switch (confidence) {
      case 'high':
        return 'High confidence';
      case 'medium':
        return 'Medium confidence';
      case 'low':
        return 'Low confidence';
    }
  };

  // Upload State
  if (scanState === 'upload') {
    return (
      <div className="p-4 pt-8 space-y-6 min-h-screen lg:p-8 lg:pt-10 dark:bg-night-base">
        {/* Header */}
        <div>
          <h1 className="text-3xl font-bold text-soft-charcoal dark:text-night-text flex items-center gap-2">
            Scan Receipt 📸
          </h1>
          <p className="text-soft-charcoal/60 dark:text-night-secondary mt-1">
            Add groceries in seconds!
          </p>
        </div>

        {/* Error Message */}
        {errorMessage && (
          <div className="bg-pastel-coral/10 rounded-xl p-4 border border-pastel-coral/30">
            <div className="flex items-start gap-2">
              <AlertCircle className="text-pastel-coral flex-shrink-0 mt-0.5" size={18} />
              <p className="text-sm text-soft-charcoal dark:text-night-text">{errorMessage}</p>
            </div>
          </div>
        )}

        {/* OCR Status Warning */}
        {ocrStatus && !ocrStatus.available && (
          <div className="bg-pastel-coral/10 rounded-xl p-3 border border-pastel-coral/30">
            <p className="text-sm text-soft-charcoal/70 dark:text-night-secondary">
              ⚠️ OCR service unavailable. {ocrStatus.message}
            </p>
          </div>
        )}

        {/* Upload Zone */}
        <div
          onClick={() => fileInputRef.current?.click()}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          className="relative bg-white rounded-2xl p-8 border-2 border-dashed border-pastel-pink/40 hover:border-pastel-pink hover:bg-pastel-pink/5 transition-all cursor-pointer dark:bg-night-surface dark:border-night-border dark:hover:bg-night-raised"
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />

          <div className="flex flex-col items-center gap-4 text-center">
            <div className="w-20 h-20 rounded-full bg-pastel-pink/10 flex items-center justify-center">
              <Camera className="text-pastel-pink" size={40} strokeWidth={2} />
            </div>

            <div>
              <p className="text-lg font-semibold text-soft-charcoal dark:text-night-text mb-1">
                Drop your receipt here
              </p>
              <p className="text-soft-charcoal/60 dark:text-night-secondary text-sm">
                or tap to upload 📷
              </p>
            </div>

            <div className="flex items-center gap-2 text-xs text-soft-charcoal/40 dark:text-night-secondary/60">
              <Upload size={14} />
              <span>PNG, JPG, or HEIC</span>
            </div>
          </div>

          {/* Decorative pattern */}
          <div className="absolute top-4 right-4 opacity-5">
            <div className="grid grid-cols-3 gap-2">
              {[...Array(9)].map((_, i) => (
                <div key={i} className="w-2 h-2 rounded-full bg-pastel-pink" />
              ))}
            </div>
          </div>
        </div>

        {/* Tips Section */}
        <div className="bg-white rounded-2xl p-5 shadow-soft dark:bg-night-surface">
          <h3 className="font-bold text-soft-charcoal dark:text-night-text mb-3 flex items-center gap-2">
            💡 Tips for best results:
          </h3>
          <ul className="space-y-2 text-sm text-soft-charcoal/70 dark:text-night-secondary">
            <li className="flex items-start gap-2">
              <span className="text-pastel-mint">•</span>
              <span>Flatten the receipt on a solid surface</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-pastel-mint">•</span>
              <span>Make sure lighting is good and text is clear</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-pastel-mint">•</span>
              <span>Include all items in the frame</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="text-pastel-mint">•</span>
              <span>Avoid shadows and glare</span>
            </li>
          </ul>
        </div>
      </div>
    );
  }

  // Processing State
  if (scanState === 'processing') {
    return (
      <div className="p-4 pt-8 flex flex-col items-center justify-center min-h-[80vh] dark:bg-night-base">
        <div className="text-center space-y-6 max-w-sm">
          {/* Preview */}
          {previewUrl && (
            <div className="relative w-full aspect-[3/4] rounded-2xl overflow-hidden shadow-soft-lg mb-6">
              <img
                src={previewUrl}
                alt="Receipt preview"
                className="w-full h-full object-cover opacity-50"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-white via-transparent to-transparent dark:from-night-base dark:via-transparent dark:to-transparent" />
            </div>
          )}

          {/* Loading Animation */}
          <div className="relative">
            <div className="w-20 h-20 mx-auto rounded-full bg-pastel-pink/10 flex items-center justify-center mb-4 dark:bg-night-pink/20">
              <Loader2 className="text-pastel-pink animate-spin" size={40} strokeWidth={2.5} />
            </div>

            {/* Bouncing food emojis */}
            <div className="flex justify-center gap-2 mb-6">
              <span className="text-2xl animate-bounce" style={{ animationDelay: '0ms' }}>🥕</span>
              <span className="text-2xl animate-bounce" style={{ animationDelay: '150ms' }}>🥛</span>
              <span className="text-2xl animate-bounce" style={{ animationDelay: '300ms' }}>🍞</span>
            </div>
          </div>

          <div>
            <h2 className="text-2xl font-bold text-soft-charcoal dark:text-night-text mb-2">
              Reading your receipt... 🔍
            </h2>
            <p className="text-soft-charcoal/60 dark:text-night-secondary">
              This might take a moment
            </p>
          </div>

          {/* Progress Steps */}
          <div className="space-y-2 text-sm text-left bg-white rounded-xl p-4 shadow-soft dark:bg-night-surface">
            <div className="flex items-center gap-2 text-pastel-mint">
              <CheckCircle size={16} />
              <span>Image uploaded</span>
            </div>
            <div className="flex items-center gap-2 text-pastel-pink">
              <Loader2 size={16} className="animate-spin" />
              <span>Extracting text...</span>
            </div>
            <div className="flex items-center gap-2 text-soft-charcoal/30 dark:text-night-secondary/40">
              <div className="w-4 h-4 rounded-full border-2 border-soft-charcoal/30" />
              <span>Identifying items</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const totalToAdd = readyToAddItems.length + needsReviewItems.length;

  // Success State
  if (scanState === 'success') {
    return (
      <div className="p-4 pt-8 flex flex-col items-center justify-center min-h-[80vh] dark:bg-night-base">
        <div className="text-center space-y-6 max-w-sm">
          <div className="w-24 h-24 mx-auto rounded-full bg-pastel-mint/20 flex items-center justify-center dark:bg-night-mint/20">
            <CheckCircle className="text-pastel-mint" size={52} strokeWidth={2} />
          </div>

          <div>
            <h2 className="text-2xl font-bold text-soft-charcoal dark:text-night-text mb-2">
              Added to pantry! 🎉
            </h2>
            <p className="text-soft-charcoal/60 dark:text-night-secondary">
              {addedCount} item{addedCount !== 1 ? 's' : ''} saved successfully
            </p>
          </div>

          {errorMessage && (
            <div className="bg-pastel-peach/10 rounded-xl p-3 border border-pastel-peach/30 text-sm text-soft-charcoal/70">
              {errorMessage}
            </div>
          )}

          <div className="flex flex-col gap-3 pt-2">
            <button
              onClick={handleReset}
              className="w-full px-6 py-3 bg-pastel-pink text-white font-semibold rounded-full shadow-soft hover:shadow-soft-lg transition-all active:scale-95"
            >
              Scan another receipt 📸
            </button>
            <a
              href="/pantry"
              className="w-full px-6 py-3 border border-pastel-mint/40 text-pastel-mint font-semibold rounded-full text-center hover:bg-pastel-mint/10 transition-all"
            >
              View pantry 🥦
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Results State
  return (
    <div className="p-4 pt-8 space-y-4 pb-32 lg:p-8 lg:pt-10 lg:pb-8 dark:bg-night-base">
      {/* Cancel confirmation overlay */}
      {showCancelConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-soft-charcoal/40 backdrop-blur-sm px-6">
          <div className="bg-white rounded-2xl p-6 shadow-soft-lg w-full max-w-sm space-y-4 dark:bg-night-surface">
            <h3 className="text-lg font-bold text-soft-charcoal dark:text-night-text">Discard this scan?</h3>
            <p className="text-sm text-soft-charcoal/60 dark:text-night-secondary">
              You have {totalToAdd} item{totalToAdd !== 1 ? 's' : ''} ready to add. If you leave now, none will be saved.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="flex-1 px-4 py-2.5 rounded-full border border-soft-charcoal/20 text-soft-charcoal font-semibold text-sm hover:bg-soft-charcoal/5 transition-all dark:border-night-border dark:text-night-text"
              >
                Keep reviewing
              </button>
              <button
                onClick={handleReset}
                className="flex-1 px-4 py-2.5 rounded-full bg-pastel-coral text-white font-semibold text-sm hover:opacity-90 transition-all"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-soft-charcoal dark:text-night-text flex items-center gap-2">
            Found {totalToAdd} items! 🎉
          </h1>
          <p className="text-soft-charcoal/60 dark:text-night-secondary text-sm mt-1">
            Review and add to your pantry
          </p>
        </div>
        <button
          onClick={() => totalToAdd > 0 ? setShowCancelConfirm(true) : handleReset()}
          className="p-2 hover:bg-soft-charcoal/5 rounded-full transition-colors"
          title="Close"
        >
          <X size={20} className="text-soft-charcoal/60 dark:text-night-secondary" />
        </button>
      </div>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-pastel-peach/10 rounded-xl p-3 border border-pastel-peach/30">
          <div className="flex items-start gap-2">
            <AlertCircle className="text-pastel-peach flex-shrink-0 mt-0.5" size={16} />
            <div className="text-sm text-soft-charcoal/70 dark:text-night-secondary space-y-1">
              {warnings.map((warning, i) => (
                <p key={i}>{warning}</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Error Message (inline, during results) */}
      {errorMessage && (
        <div className="bg-pastel-coral/10 rounded-xl p-3 border border-pastel-coral/30">
          <div className="flex items-start gap-2">
            <AlertCircle className="text-pastel-coral flex-shrink-0 mt-0.5" size={16} />
            <p className="text-sm text-soft-charcoal dark:text-night-text">{errorMessage}</p>
          </div>
        </div>
      )}

      {/* Ready to Add Section */}
      {readyToAddItems.length > 0 && (
        <div className="bg-pastel-mint/10 rounded-2xl p-4 border border-pastel-mint/30">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-soft-charcoal dark:text-night-text flex items-center gap-2">
              <CheckCircle className="text-pastel-mint" size={20} />
              Ready to Add ({readyToAddItems.length})
            </h3>
          </div>

          <div className="space-y-2">
            {readyToAddItems.map((item) => (
              <div
                key={item.id}
                className="bg-white rounded-xl p-3 dark:bg-night-raised"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <CheckCircle className="text-pastel-mint flex-shrink-0" size={18} />
                      <input
                        ref={(el) => {
                          if (!readyToAddRefs.current.has(item.id)) {
                            readyToAddRefs.current.set(item.id, { name: null, quantity: null, unit: null, expiry: null, location: null });
                          }
                          const refs = readyToAddRefs.current.get(item.id);
                          if (refs) refs.name = el;
                        }}
                        type="text"
                        defaultValue={item.name}
                        className="flex-1 px-3 py-2 rounded-lg border border-pastel-mint/20 focus:outline-none focus:border-pastel-mint focus:ring-2 focus:ring-pastel-mint/20 transition-all text-sm font-semibold dark:bg-night-raised dark:border-night-border dark:text-night-text"
                      />
                    </div>
                    <div className="flex gap-2 ml-7">
                      <input
                        ref={(el) => {
                          const refs = readyToAddRefs.current.get(item.id);
                          if (refs) refs.quantity = el;
                        }}
                        type="number"
                        defaultValue={item.quantity}
                        className="w-20 px-3 py-1.5 rounded-lg border border-pastel-mint/20 focus:outline-none focus:border-pastel-mint focus:ring-2 focus:ring-pastel-mint/20 transition-all text-sm dark:bg-night-raised dark:border-night-border dark:text-night-text"
                      />
                      <select
                        ref={(el) => {
                          const refs = readyToAddRefs.current.get(item.id);
                          if (refs) refs.unit = el;
                        }}
                        defaultValue={UNIT_OPTIONS.includes(item.unit) ? item.unit : 'item'}
                        className="flex-1 px-3 py-1.5 rounded-lg border border-pastel-mint/20 focus:outline-none focus:border-pastel-mint transition-all text-sm dark:bg-night-raised dark:border-night-border dark:text-night-text"
                      >
                        {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <div className="flex gap-2 ml-7">
                      <input
                        ref={(el) => {
                          const refs = readyToAddRefs.current.get(item.id);
                          if (refs) refs.expiry = el;
                        }}
                        type="date"
                        defaultValue={item.expiryDate ?? ''}
                        className="flex-1 px-3 py-1.5 rounded-lg border border-pastel-mint/20 focus:outline-none focus:border-pastel-mint transition-all text-sm dark:bg-night-raised dark:border-night-border dark:text-night-text"
                      />
                      <select
                        ref={(el) => {
                          const refs = readyToAddRefs.current.get(item.id);
                          if (refs) refs.location = el;
                        }}
                        defaultValue={item.location}
                        className="flex-1 px-3 py-1.5 rounded-lg border border-pastel-mint/20 focus:outline-none focus:border-pastel-mint transition-all text-sm dark:bg-night-raised dark:border-night-border dark:text-night-text"
                      >
                        {LOCATION_OPTIONS.map(l => (
                          <option key={l.value} value={l.value}>{l.emoji} {l.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <button
                    onClick={() => dismissItem(item, 'ready')}
                    className="ml-2 p-1 hover:bg-soft-charcoal/5 rounded-full transition-colors"
                    title="Dismiss (can undo)"
                  >
                    <X size={16} className="text-soft-charcoal/40" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Needs Review Section */}
      {needsReviewItems.length > 0 && (
        <div className="bg-pastel-peach/10 rounded-2xl p-4 border border-pastel-peach/30">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-soft-charcoal dark:text-night-text flex items-center gap-2">
              <AlertCircle className="text-pastel-peach" size={20} />
              Please Check ({needsReviewItems.length})
            </h3>
          </div>

          <div className="space-y-3">
            {needsReviewItems.map((item) => (
              <div
                key={item.id}
                className="bg-white rounded-xl p-3 space-y-2 dark:bg-night-raised"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <input
                        ref={(el) => {
                          if (!needsReviewRefs.current.has(item.id)) {
                            needsReviewRefs.current.set(item.id, { name: null, quantity: null, unit: null, expiry: null, location: null });
                          }
                          const refs = needsReviewRefs.current.get(item.id);
                          if (refs) refs.name = el;
                        }}
                        type="text"
                        defaultValue={item.name}
                        placeholder="Item name"
                        className="flex-1 px-3 py-2 rounded-lg border border-pastel-pink/20 focus:outline-none focus:border-pastel-pink focus:ring-2 focus:ring-pastel-pink/20 transition-all text-sm dark:bg-night-raised dark:border-night-border dark:text-night-text"
                      />
                      <span className={`px-2 py-1 rounded-full text-xs ${getConfidenceBadge(item.confidence)}`}>
                        {getConfidenceText(item.confidence)}
                      </span>
                    </div>
                    <div className="flex gap-2">
                      <input
                        ref={(el) => {
                          const refs = needsReviewRefs.current.get(item.id);
                          if (refs) refs.quantity = el;
                        }}
                        type="number"
                        defaultValue={item.quantity}
                        className="w-20 px-3 py-1.5 rounded-lg border border-pastel-pink/20 focus:outline-none focus:border-pastel-pink focus:ring-2 focus:ring-pastel-pink/20 transition-all text-sm dark:bg-night-raised dark:border-night-border dark:text-night-text"
                      />
                      <select
                        ref={(el) => {
                          const refs = needsReviewRefs.current.get(item.id);
                          if (refs) refs.unit = el;
                        }}
                        defaultValue={UNIT_OPTIONS.includes(item.unit) ? item.unit : 'item'}
                        className="flex-1 px-3 py-1.5 rounded-lg border border-pastel-pink/20 focus:outline-none focus:border-pastel-pink transition-all text-sm dark:bg-night-raised dark:border-night-border dark:text-night-text"
                      >
                        {UNIT_OPTIONS.map(u => <option key={u} value={u}>{u}</option>)}
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <input
                        ref={(el) => {
                          const refs = needsReviewRefs.current.get(item.id);
                          if (refs) refs.expiry = el;
                        }}
                        type="date"
                        defaultValue={item.expiryDate ?? ''}
                        className="flex-1 px-3 py-1.5 rounded-lg border border-pastel-pink/20 focus:outline-none focus:border-pastel-pink transition-all text-sm dark:bg-night-raised dark:border-night-border dark:text-night-text"
                      />
                      <select
                        ref={(el) => {
                          const refs = needsReviewRefs.current.get(item.id);
                          if (refs) refs.location = el;
                        }}
                        defaultValue={item.location}
                        className="flex-1 px-3 py-1.5 rounded-lg border border-pastel-pink/20 focus:outline-none focus:border-pastel-pink transition-all text-sm dark:bg-night-raised dark:border-night-border dark:text-night-text"
                      >
                        {LOCATION_OPTIONS.map(l => (
                          <option key={l.value} value={l.value}>{l.emoji} {l.label}</option>
                        ))}
                      </select>
                    </div>
                    {item.rawText && (
                      <p className="text-xs text-soft-charcoal/40 dark:text-night-secondary/60">
                        Original: {item.rawText}
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => dismissItem(item, 'review')}
                    className="ml-2 p-1 hover:bg-soft-charcoal/5 rounded-full transition-colors"
                    title="Dismiss (can undo)"
                  >
                    <X size={16} className="text-soft-charcoal/40" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Skipped Items Section */}
      {skippedItems.length > 0 && (
        <div className="bg-soft-charcoal/5 rounded-2xl p-4 border border-soft-charcoal/20 dark:bg-night-raised/50 dark:border-night-border">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-soft-charcoal dark:text-night-text flex items-center gap-2">
              <AlertCircle className="text-soft-charcoal/60" size={20} />
              Skipped ({skippedItems.length})
            </h3>
          </div>
          <p className="text-xs text-soft-charcoal/60 dark:text-night-secondary mb-3">
            These items had very low confidence. Review and add manually if needed.
          </p>

          <div className="space-y-2">
            {skippedItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 bg-white rounded-xl dark:bg-night-raised"
              >
                <div className="flex-1">
                  <p className="font-medium text-soft-charcoal dark:text-night-text text-sm">{item.name}</p>
                  <p className="text-xs text-soft-charcoal/40 dark:text-night-secondary/60">
                    Original: {item.rawText}
                  </p>
                </div>
                <button
                  onClick={() => moveToReview(item.id)}
                  className="ml-3 px-3 py-1.5 text-xs text-pastel-pink hover:bg-pastel-pink hover:text-white rounded-lg transition-all border border-pastel-pink/30"
                >
                  Review
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dismissed Items Section — recoverable */}
      {dismissedItems.length > 0 && (
        <div className="bg-soft-charcoal/5 rounded-2xl p-4 border border-soft-charcoal/10 dark:bg-night-raised/50 dark:border-night-border">
          <div className="flex items-center justify-between mb-2">
            <h3 className="font-semibold text-soft-charcoal/50 dark:text-night-secondary text-sm flex items-center gap-2">
              <X size={16} className="text-soft-charcoal/30" />
              Dismissed ({dismissedItems.length})
            </h3>
          </div>
          <p className="text-xs text-soft-charcoal/40 dark:text-night-secondary/60 mb-3">
            Tap ↩ to restore any dismissed item.
          </p>
          <div className="space-y-1.5">
            {dismissedItems.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between px-3 py-2 bg-white/60 rounded-xl dark:bg-night-raised/60"
              >
                <p className="text-sm text-soft-charcoal/50 dark:text-night-secondary line-through">{item.name}</p>
                <button
                  onClick={() => restoreItem(item)}
                  className="ml-3 p-1.5 text-pastel-pink hover:bg-pastel-pink/10 rounded-full transition-all"
                  title="Restore item"
                >
                  <RotateCcw size={14} />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Couldn't Read Section */}
      {failedItems.length > 0 && (
        <div className="bg-soft-charcoal/5 rounded-2xl p-4 dark:bg-night-raised/50">
          <h3 className="font-bold text-soft-charcoal dark:text-night-text flex items-center gap-2 mb-3">
            <X className="text-soft-charcoal/40" size={20} />
            Couldn't read ({failedItems.length})
          </h3>
          <div className="space-y-2">
            {failedItems.map((text, i) => (
              <p key={i} className="text-sm text-soft-charcoal/50 dark:text-night-secondary font-mono">
                {text}
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="fixed bottom-20 left-0 right-0 p-4 bg-gradient-to-t from-cream via-cream to-transparent lg:static lg:bottom-auto lg:[background:none] lg:p-0 lg:pt-2 dark:from-night-base dark:via-night-base dark:to-transparent">
        <div className="max-w-lg lg:max-w-5xl mx-auto flex gap-3">
          <button
            onClick={() => totalToAdd > 0 ? setShowCancelConfirm(true) : handleReset()}
            className="px-6 py-3 text-soft-charcoal/60 dark:text-night-secondary font-semibold rounded-full hover:bg-soft-charcoal/5 transition-all"
          >
            Cancel
          </button>
          {totalToAdd > 0 ? (
            <button
              onClick={addSelectedItems}
              disabled={confirmMutation.isPending}
              className="flex-1 px-6 py-3 bg-pastel-coral text-white font-bold rounded-full shadow-soft hover:shadow-soft-lg hover:opacity-90 transition-all active:scale-95 disabled:opacity-50"
            >
              {confirmMutation.isPending
                ? 'Adding...'
                : `Add ${totalToAdd} Item${totalToAdd !== 1 ? 's' : ''} to Pantry`}
            </button>
          ) : (
            <button
              onClick={handleReset}
              className="flex-1 px-6 py-3 bg-pastel-mint text-white font-semibold rounded-full shadow-soft hover:shadow-soft-lg transition-all active:scale-95"
            >
              Done ✓
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
