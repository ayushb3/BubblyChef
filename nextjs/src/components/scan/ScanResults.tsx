/**
 * Backward-compatible re-export.
 *
 * The tiered review UI moved to `ReviewSurface` (presentation-only — see
 * issue #259). This file is kept as a thin alias so any existing import of
 * `ScanResults` (and its prop type) keeps working without a second
 * implementation to maintain.
 */
export { default, type ReviewSurfaceProps as ScanResultsProps } from './ReviewSurface'
