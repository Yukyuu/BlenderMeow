// Undo / Redo snapshot history
import type { BuilderDocument, DocumentSnapshot } from './document';

export interface HistoryEntry {
  label: string;
  snap: DocumentSnapshot;
}

export class History {
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private max = 40;
  pushSeq = 0;

  get canUndo(): boolean { return this.undoStack.length > 0; }
  get canRedo(): boolean { return this.redoStack.length > 0; }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }

  discardLast(): boolean {
    if (this.undoStack.length === 0) return false;
    this.undoStack.pop();
    return true;
  }

  push(label: string, doc: BuilderDocument) {
    this.undoStack.push({ label, snap: doc.snapshot() });
    if (this.undoStack.length > this.max) this.undoStack.shift();
    this.redoStack.length = 0;
    this.pushSeq++;
  }

  undo(doc: BuilderDocument): string | null {
    const e = this.undoStack.pop();
    if (!e) return null;
    this.redoStack.push({ label: e.label, snap: doc.snapshot() });
    doc.restore(e.snap);
    return e.label;
  }

  redo(doc: BuilderDocument): string | null {
    const e = this.redoStack.pop();
    if (!e) return null;
    this.undoStack.push({ label: e.label, snap: doc.snapshot() });
    doc.restore(e.snap);
    return e.label;
  }
}
