'use client'

    < button
onClick = {() => handleSend('note')}
className = "p-3 rounded-full bg-accent-green/10 text-accent-green hover:bg-accent-green/20 transition-colors"
title = "Add Note"
    >
    <Plus className="w-5 h-5" />
                                    </button >
    <button
        onClick={() => handleSend('question')}
        className="p-3 rounded-full bg-primary text-white shadow-lg shadow-primary/30 hover:scale-105 active:scale-95 transition-all"
        title="Ask AI"
    >
        <Send className="w-5 h-5" />
    </button>
                                </motion.div >
                            ) : (
    <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
    >
        {/* Placeholder or alternative actions when empty could go here */}
    </motion.div>
)}
                        </AnimatePresence >
                    </div >
                </div >
            </div >
        </motion.div >
    )
}
