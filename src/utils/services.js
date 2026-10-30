/**
 * QueueLess Service Catalogue & Formatting Utilities
 * Source of truth: docs/requirements.md (Version 1.2.0)
 */

export const APPROVED_SERVICES = [
  {
    id: 'admissions',
    name: 'Admissions & Document Verification',
    prefix: 'ADM',
    baselineDurationMinutes: 5,
    counterNumber: 'Counter 1',
    description: 'Academic certificate verification, enrollment formalities, and admission eligibility validation.'
  },
  {
    id: 'finance',
    name: 'Finance & Fee Clearance',
    prefix: 'FIN',
    baselineDurationMinutes: 3,
    counterNumber: 'Counter 2',
    description: 'Tuition fee payment receipts, bank challan processing, and financial dues clearance.'
  },
  {
    id: 'examinations',
    name: 'Examinations & Records',
    prefix: 'EXM',
    baselineDurationMinutes: 6,
    counterNumber: 'Counter 3',
    description: 'Grade card verification, transcript issuance, duplicate ID cards, and official student academic records.'
  }
];

/**
 * Format token identifier to standard sequential representation (<PREFIX>-<000>)
 * Guarantee: Begins strictly at 001. A token sequence will never display ending in '000'.
 *
 * @param {string} prefix - Service prefix (e.g., 'ADM', 'FIN', 'EXM')
 * @param {number} sequenceNumber - Sequential integer (1-indexed)
 * @returns {string} Formatted token (e.g., 'ADM-001')
 */
export function formatTokenNumber(prefix, sequenceNumber) {
  const safePrefix = (prefix || 'TOK').toUpperCase();
  // Guarantee sequence starts at 1, eliminating any '000' display error
  const safeSeq = Math.max(1, Math.floor(sequenceNumber || 1));
  return `${safePrefix}-${String(safeSeq).padStart(3, '0')}`;
}
