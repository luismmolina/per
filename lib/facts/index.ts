export { FACT_EXTRACTOR_VERSION, STATE_ELIGIBLE_POLARITIES } from './types'
export type {
  CurrentStateRecord,
  FactEvent,
  FactIndexStatus,
  FactPolarity,
  FactSyncResult,
  NoteFactIndexRecord,
} from './types'

export {
  isNoteFactsEnabled,
  syncConversationNoteFacts,
  recomputeCurrentStateForKeys,
  getFactLedgerStatus,
} from './sync'
export type { FactLedgerStatus } from './sync'
export { formatWorldStateForPrompt, prependWorldStateToNotes } from './format'
export { listCurrentState, listFactIndexRecords, listAllFactEvents } from './store'
export { buildStateKey } from './extract'
