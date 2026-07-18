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
export {
  formatWorldStateForPrompt,
  loadWorldStateForPromptBudget,
  combineWorldStateAndNotes,
  prependWorldStateToNotes,
} from './format'
export type { WorldStateBudget } from './format'
export {
  listCurrentState,
  listCurrentStateSample,
  listFactIndexRecords,
  listAllFactEvents,
  getFactIndex,
  getCurrentState,
  getFactLedgerMeta,
} from './store'
export { buildStateKey } from './extract'
