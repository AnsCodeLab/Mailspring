import fs from 'fs';
import path from 'path';
import { List } from 'immutable';
import { Editor, Value, Document, Block, ValueJSON, BlockJSON, TextJSON } from 'slate';
import TablePlugins, {
  TABLE_TYPE,
  TABLE_ROW_TYPE,
  TABLE_CELL_TYPE,
  rules,
  tableKeyForCell,
  nextCell,
  previousCell,
  decideTabForward,
  decideTabBackward,
  decideBoundaryRemoval,
  insertTable,
  isSimpleTableElement,
} from '../src/components/composer-editor/table-plugins';
import { convertFromHTML } from '../src/components/composer-editor/conversion';

// ---------------------------------------------------------------------------
// Pure-logic: bounded cell traversal (nextCell/previousCell/tableKeyForCell)
// ---------------------------------------------------------------------------
// Mirrors this session's established convention: feed a fake `document`
// exposing exactly the methods under test, keyed by node key, rather than
// mounting a full Slate document/editor.

function fakeCell(key: string): Block {
  return { key, type: TABLE_CELL_TYPE, object: 'block' } as unknown as Block;
}

function fakeDocument(config: {
  types: Record<string, string>;
  next?: Record<string, string>;
  previous?: Record<string, string>;
  tableForKey: Record<string, string>;
}): Document {
  const build = (key: string) => ({ key, type: config.types[key], object: 'block' });
  // Independent-review-gate finding: the real Slate `getNextBlock`/`getPreviousBlock`
  // throw when given anything other than a string key (verified directly against
  // `slate.js`, and against a live reproduction of the exact bug this strictness now
  // guards against -- an earlier revision of `nextCell`/`previousCell` passed a Block
  // object instead of `.key`, which compiled cleanly against `@types/slate`'s
  // (incorrect) `string | Node` signature but threw at runtime). A fake that silently
  // accepted both shapes would never have caught that regression at the unit-test
  // level; require a string here too, so a future reintroduction of the same mistake
  // fails these tests immediately instead of only surfacing in the browser/e2e layer.
  const requireStringKey = (n: unknown): string => {
    if (typeof n !== 'string') {
      throw new Error(
        `fakeDocument's getNextBlock/getPreviousBlock/getClosest require a string key, matching the real Slate API -- got: ${JSON.stringify(n)}`
      );
    }
    return n;
  };
  const doc = {
    getNextBlock: (n: unknown) => {
      const nextKey = (config.next || {})[requireStringKey(n)];
      return nextKey ? build(nextKey) : null;
    },
    getPreviousBlock: (n: unknown) => {
      const previousKey = (config.previous || {})[requireStringKey(n)];
      return previousKey ? build(previousKey) : null;
    },
    getClosest: (key: unknown) => {
      const tableKey = config.tableForKey[requireStringKey(key)];
      return tableKey ? { key: tableKey, type: TABLE_TYPE, object: 'block' } : null;
    },
  };
  return doc as unknown as Document;
}

describe('tableKeyForCell', () => {
  it('returns the enclosing table key for a cell', () => {
    const doc = fakeDocument({ types: {}, tableForKey: { c1: 't1' } });
    expect(tableKeyForCell(doc, fakeCell('c1'))).toBe('t1');
  });

  it('returns null when the cell is not inside a table', () => {
    const doc = fakeDocument({ types: {}, tableForKey: {} });
    expect(tableKeyForCell(doc, fakeCell('orphan'))).toBeNull();
  });
});

describe('nextCell', () => {
  it('returns the next cell within the same table', () => {
    const doc = fakeDocument({
      types: { c1: TABLE_CELL_TYPE, c2: TABLE_CELL_TYPE },
      next: { c1: 'c2' },
      tableForKey: { c1: 't1', c2: 't1' },
    });
    expect(nextCell(doc, fakeCell('c1')).key).toBe('c2');
  });

  it('skips past a non-cell container block returned mid-traversal', () => {
    const doc = fakeDocument({
      types: { c1: TABLE_CELL_TYPE, rowWrapper: TABLE_ROW_TYPE, c2: TABLE_CELL_TYPE },
      next: { c1: 'rowWrapper', rowWrapper: 'c2' },
      tableForKey: { c1: 't1', c2: 't1' },
    });
    expect(nextCell(doc, fakeCell('c1')).key).toBe('c2');
  });

  it('returns null instead of tunneling into a second, unrelated table (confirmed cross-table bug, fixed)', () => {
    const doc = fakeDocument({
      types: { c1: TABLE_CELL_TYPE, c2: TABLE_CELL_TYPE, c3: TABLE_CELL_TYPE },
      next: { c1: 'c2', c2: 'c3' },
      tableForKey: { c1: 't1', c2: 't1', c3: 't2' },
    });
    // The raw, unbounded traversal WOULD find c3 -- proving the underlying bug is real.
    expect(doc.getNextBlock('c2')).not.toBeNull();
    // The bounded implementation must reject it: c3 belongs to a different table.
    expect(nextCell(doc, fakeCell('c2'))).toBeNull();
  });

  it('returns null at the last cell of a table with no further content', () => {
    const doc = fakeDocument({ types: { c1: TABLE_CELL_TYPE }, tableForKey: { c1: 't1' } });
    expect(nextCell(doc, fakeCell('c1'))).toBeNull();
  });
});

describe('previousCell', () => {
  it('returns the previous cell within the same table', () => {
    const doc = fakeDocument({
      types: { c1: TABLE_CELL_TYPE, c2: TABLE_CELL_TYPE },
      previous: { c2: 'c1' },
      tableForKey: { c1: 't1', c2: 't1' },
    });
    expect(previousCell(doc, fakeCell('c2')).key).toBe('c1');
  });

  it('returns null instead of tunneling into a second, unrelated table', () => {
    const doc = fakeDocument({
      types: { c1: TABLE_CELL_TYPE, c2: TABLE_CELL_TYPE },
      previous: { c1: 'c2' }, // c1 sits right after an unrelated table's last cell
      tableForKey: { c1: 't1', c2: 't2' },
    });
    expect(previousCell(doc, fakeCell('c1'))).toBeNull();
  });

  it('returns null at the first cell of a table', () => {
    const doc = fakeDocument({ types: { c1: TABLE_CELL_TYPE }, tableForKey: { c1: 't1' } });
    expect(previousCell(doc, fakeCell('c1'))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Pure-logic: Tab / Shift+Tab decisions
// ---------------------------------------------------------------------------

describe('decideTabForward', () => {
  it('moves to the next cell when one exists in the same table', () => {
    const doc = fakeDocument({
      types: { c1: TABLE_CELL_TYPE, c2: TABLE_CELL_TYPE },
      next: { c1: 'c2' },
      tableForKey: { c1: 't1', c2: 't1' },
    });
    expect(decideTabForward(doc, fakeCell('c1'))).toEqual({
      action: 'moveToCell',
      cell: doc.getNextBlock('c1'),
    });
  });

  it('requests a new row when at the last cell of the last row', () => {
    const doc = fakeDocument({ types: { c1: TABLE_CELL_TYPE }, tableForKey: { c1: 't1' } });
    expect(decideTabForward(doc, fakeCell('c1'))).toEqual({ action: 'insertRow' });
  });
});

describe('decideTabBackward', () => {
  it('moves to the previous cell when one exists in the same table', () => {
    const doc = fakeDocument({
      types: { c1: TABLE_CELL_TYPE, c2: TABLE_CELL_TYPE },
      previous: { c2: 'c1' },
      tableForKey: { c1: 't1', c2: 't1' },
    });
    expect(decideTabBackward(doc, fakeCell('c2'))).toEqual({
      action: 'moveToCell',
      cell: doc.getPreviousBlock('c2'),
    });
  });

  it('does nothing (lets Tab-out-of-editor proceed) at the first cell of a table', () => {
    const doc = fakeDocument({ types: { c1: TABLE_CELL_TYPE }, tableForKey: { c1: 't1' } });
    expect(decideTabBackward(doc, fakeCell('c1'))).toEqual({ action: 'none' });
  });
});

// ---------------------------------------------------------------------------
// Pure-logic: Backspace/Delete boundary-removal decision (shared by both keys;
// the direction-specific cursor capture lives in onKeyDown, not tested here).
// ---------------------------------------------------------------------------

describe('decideBoundaryRemoval', () => {
  function tableWithTexts(texts: string[]): Block {
    return { getTexts: () => List(texts.map((text) => ({ text }))) } as unknown as Block;
  }

  it('moves to the adjacent cell when one exists (boundary not reached)', () => {
    const adjacent = fakeCell('c2');
    expect(decideBoundaryRemoval(tableWithTexts(['']), adjacent)).toEqual({
      action: 'moveToAdjacentCell',
      cell: adjacent,
    });
  });

  it('removes the whole table when at the boundary cell and every cell is empty', () => {
    expect(decideBoundaryRemoval(tableWithTexts(['', '', '', '']), null)).toEqual({
      action: 'removeTable',
    });
  });

  it('only prevents default (no-op) when at the boundary cell but the table has other content', () => {
    expect(decideBoundaryRemoval(tableWithTexts(['', 'has content', '', '']), null)).toEqual({
      action: 'preventOnly',
    });
  });
});

// ---------------------------------------------------------------------------
// HTML round-trip rules, called directly against fake DOM-like elements.
// ---------------------------------------------------------------------------

describe('table HTML round-trip rules', () => {
  const [tableRule] = rules;

  type FakeElement = {
    tagName: string;
    childNodes: FakeElement[];
    children: FakeElement[];
    querySelector: (selector: string) => FakeElement | null;
    querySelectorAll: (selector: string) => FakeElement[];
  };
  type FakeJSON = { object: string; type: string; nodes: FakeJSON[] };
  type FakeReactElement = { type: string; props: { children: unknown } };

  // `isSimpleTableElement` (called from the real `<table>` deserialize branch below)
  // needs `querySelector`/`querySelectorAll`/`children` on whatever it's given -- these
  // fixtures are plain `{tagName, childNodes}` doubles, not real DOM `Element`s, so add
  // minimal tag-name-only matching (the only selector shapes `isSimpleTableElement`
  // actually uses: `'table'` and `'td, th'`) rather than pulling in a real DOM/JSDOM
  // dependency for a handful of simple fixtures with no nested structure to match.
  function matchesSelector(el: FakeElement, selector: string): boolean {
    return selector.split(',').some((part) => part.trim() === el.tagName);
  }
  function collectMatches(el: FakeElement, selector: string, out: FakeElement[]) {
    for (const child of el.childNodes) {
      if (matchesSelector(child, selector)) out.push(child);
      collectMatches(child, selector, out);
    }
  }

  function fakeEl(tagName: string, childNodes: FakeElement[] = []): FakeElement {
    const el: FakeElement = {
      tagName,
      childNodes,
      children: childNodes,
      querySelector: (selector) => {
        const matches: FakeElement[] = [];
        collectMatches(el, selector, matches);
        return matches[0] || null;
      },
      querySelectorAll: (selector) => {
        const matches: FakeElement[] = [];
        collectMatches(el, selector, matches);
        return matches;
      },
    };
    return el;
  }

  // `Rule.deserialize`/`serialize` are typed against real DOM `Element`/React-node
  // shapes; these fixtures are plain `{tagName, childNodes}` doubles (mirrors this
  // session's fake-Slate/DOM-object testing convention). Bridge the two once, here,
  // rather than casting at every call site below.
  function deserializeFake(el: FakeElement, next: (nodes: FakeElement[]) => unknown) {
    const deserialize = tableRule.deserialize as unknown as (
      el: FakeElement,
      next: (nodes: FakeElement[]) => unknown
    ) => FakeJSON | undefined;
    return deserialize(el, next);
  }

  function serializeFake(obj: { object: string; type?: string }, children: unknown) {
    const serialize = tableRule.serialize as unknown as (
      obj: { object: string; type?: string },
      children: unknown
    ) => FakeReactElement | undefined;
    return serialize(obj, children);
  }

  it('deserializes <table> into a table block', () => {
    const childNodes = [fakeEl('tr')];
    const result = deserializeFake(fakeEl('table', childNodes), (nodes) => nodes);
    expect(result).toEqual({ object: 'block', type: TABLE_TYPE, nodes: childNodes });
  });

  it('deserializes <tr> into a table_row block', () => {
    const childNodes = [fakeEl('td')];
    const result = deserializeFake(fakeEl('tr', childNodes), (nodes) => nodes);
    expect(result).toEqual({ object: 'block', type: TABLE_ROW_TYPE, nodes: childNodes });
  });

  it('deserializes <td> into a table_cell block', () => {
    expect(deserializeFake(fakeEl('td'), (nodes) => nodes)).toEqual({
      object: 'block',
      type: TABLE_CELL_TYPE,
      nodes: [],
    });
  });

  it('deserializes <th> into a table_cell block (th-tolerant)', () => {
    expect(deserializeFake(fakeEl('th'), (nodes) => nodes)).toEqual({
      object: 'block',
      type: TABLE_CELL_TYPE,
      nodes: [],
    });
  });

  it('returns undefined for unrelated tags', () => {
    expect(deserializeFake(fakeEl('span'), (nodes) => nodes)).toBeUndefined();
  });

  it('tolerates a <tbody> wrapper by recursing into unknown elements (mirrors the real deserializer fallback)', () => {
    const tableEl = fakeEl('table', [fakeEl('tbody', [fakeEl('tr', [fakeEl('td')])])]);

    // The real `slate-html-serializer` deserializer falls back to recursing into an
    // unmatched element's own children (`deserializeElement`, read directly) -- this
    // is the exact continuation our rule relies on to skip transparently through
    // <tbody>, reproduced minimally rather than mounting the whole library.
    function nextThroughUnknown(nodes: FakeElement[]): FakeJSON[] {
      return nodes.flatMap((node) => {
        const result = deserializeFake(node, nextThroughUnknown);
        return result !== undefined ? [result] : nextThroughUnknown(node.childNodes);
      });
    }

    const result = deserializeFake(tableEl, nextThroughUnknown);
    expect(result.type).toBe(TABLE_TYPE);
    expect(result.nodes.length).toBe(1);
    expect(result.nodes[0].type).toBe(TABLE_ROW_TYPE);
    expect(result.nodes[0].nodes[0].type).toBe(TABLE_CELL_TYPE);
  });

  it('serializes a table block into <table><tbody>...', () => {
    const el = serializeFake({ object: 'block', type: TABLE_TYPE }, 'ROWS');
    expect(el.type).toBe('table');
    const tbody = el.props.children as FakeReactElement;
    expect(tbody.type).toBe('tbody');
    expect(tbody.props.children).toBe('ROWS');
  });

  it('serializes a table_row block into <tr>', () => {
    const el = serializeFake({ object: 'block', type: TABLE_ROW_TYPE }, 'CELLS');
    expect(el.type).toBe('tr');
    expect(el.props.children).toBe('CELLS');
  });

  it('serializes a table_cell block into <td>', () => {
    const el = serializeFake({ object: 'block', type: TABLE_CELL_TYPE }, 'TEXT');
    expect(el.type).toBe('td');
    expect(el.props.children).toBe('TEXT');
  });

  it('returns undefined when serializing a non-block object', () => {
    expect(serializeFake({ object: 'text' }, 'x')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// TABLE_SCHEMA normalization against a real Slate `Editor`.
// ---------------------------------------------------------------------------

function textJSON(text: string): TextJSON {
  return { object: 'text', leaves: [{ object: 'leaf', text }] };
}

function cellJSON(text: string): BlockJSON {
  return { object: 'block', type: TABLE_CELL_TYPE, nodes: [textJSON(text)] };
}

function rowJSON(...cellTexts: string[]): BlockJSON {
  return { object: 'block', type: TABLE_ROW_TYPE, nodes: cellTexts.map(cellJSON) };
}

function tableJSON(...rows: BlockJSON[]): BlockJSON {
  return { object: 'block', type: TABLE_TYPE, nodes: rows };
}

// Confirmed nested-table-via-paste bug check: no `table_cell` anywhere in the document
// may have a `table` as a direct child.
function allTablesInDocument(document: Document) {
  // `Document.getBlocksByType` only matches LEAF blocks (verified against the
  // installed Slate runtime); a `table` always has `table_row` children, so it is
  // never a leaf block and `getBlocksByType` would silently never find one.
  // `filterDescendants` has no such restriction.
  return document.filterDescendants((n) => n.object === 'block' && n.type === TABLE_TYPE);
}

function hasNestedTable(document: Document): boolean {
  return allTablesInDocument(document).some((table) => {
    const parent = document.getParent(table.key);
    return parent !== null && parent.object === 'block' && parent.type === TABLE_CELL_TYPE;
  });
}

describe('TABLE_SCHEMA normalization', () => {
  it('repairs a table_cell that is a direct child of table (skipping table_row)', () => {
    const malformed: ValueJSON = {
      document: {
        object: 'document',
        nodes: [{ object: 'block', type: TABLE_TYPE, nodes: [cellJSON('oops')] }],
      },
    };
    const editor = new Editor({ value: Value.fromJSON(malformed), plugins: TablePlugins });

    const table = editor.value.document.nodes.get(0) as Block;
    expect(table.type).toBe(TABLE_TYPE);
    expect(table.nodes.size).toBe(1);
    const row = table.nodes.get(0) as Block;
    expect(row.type).toBe(TABLE_ROW_TYPE);
    expect(row.nodes.size).toBe(1);
    const cell = row.nodes.get(0) as Block;
    expect(cell.type).toBe(TABLE_CELL_TYPE);
    expect(cell.text).toBe('oops');
  });

  it('does not modify an already-valid table > table_row > table_cell tree (no spurious repair churn)', () => {
    const valid: ValueJSON = {
      document: { object: 'document', nodes: [tableJSON(rowJSON('a', 'b'), rowJSON('c', 'd'))] },
    };
    const editor = new Editor({ value: Value.fromJSON(valid), plugins: TablePlugins });
    expect(editor.operations.size).toBe(0);
  });

  it('hoists a pasted table out to a sibling instead of nesting it inside an existing cell (confirmed nested-table-via-paste bug)', () => {
    const existing: ValueJSON = {
      document: { object: 'document', nodes: [tableJSON(rowJSON('x', 'y'))] },
    };
    const editor = new Editor({ value: Value.fromJSON(existing), plugins: TablePlugins });

    const tableA = editor.value.document.nodes.get(0) as Block;
    const firstRowOfTableA = tableA.nodes.get(0) as Block;
    const firstCell = firstRowOfTableA.nodes.get(0) as Block;
    editor.moveToStartOfNode(firstCell).focus();

    const fragment = Document.fromJSON({
      object: 'document',
      nodes: [tableJSON(rowJSON('p', 'q'), rowJSON('r', 's'))],
    });
    editor.insertFragment(fragment);

    expect(hasNestedTable(editor.value.document)).toBe(false);
    expect(allTablesInDocument(editor.value.document).size).toBe(2);
  });
});

describe('excel table paste fixture', () => {
  it('parses a real Excel-clipboard table and, pasted into an existing cell, does not nest a table inside it', () => {
    const fixturePath = path.resolve(__dirname, 'fixtures', 'paste', 'excel-paste-in.html');
    const raw = fs.readFileSync(fixturePath, 'utf8');
    // The fixture file is wrapped in a literal leading/trailing `"` character.
    const html = raw.slice(1, -1);

    const pastedValue = convertFromHTML(html);
    // `convertFromHTML` only deserializes HTML into a `Value` -- it does not run
    // through a schema-backed `Editor`, so `pastedValue.document` here is the RAW,
    // not-yet-normalized parse (may still contain stray non-row children from
    // whitespace/<col> siblings). The real structural guarantee (hoisted, not
    // nested) is asserted below once this fragment is inserted into a real,
    // schema-backed `Editor`.
    const pastedTable = pastedValue.document.nodes.find((n) => n.type === TABLE_TYPE) as Block;
    expect(pastedTable).toBeTruthy();
    expect(pastedTable.getTexts().some((t) => t.text.includes('Pros'))).toBe(true);

    const existing: ValueJSON = {
      document: { object: 'document', nodes: [tableJSON(rowJSON('existing'))] },
    };
    const editor = new Editor({ value: Value.fromJSON(existing), plugins: TablePlugins });
    const existingTable = editor.value.document.nodes.get(0) as Block;
    const firstRowOfExistingTable = existingTable.nodes.get(0) as Block;
    const existingCell = firstRowOfExistingTable.nodes.get(0) as Block;
    editor.moveToStartOfNode(existingCell).focus();

    editor.insertFragment(pastedValue.document);

    expect(hasNestedTable(editor.value.document)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isSimpleTableElement / uneditable-plugins fallthrough: a real-world layout
// table (nested tables-in-<td>s-in-tables, routine in marketing/newsletter/
// invoice HTML) must NOT be parsed into the editable table model -- it must
// keep falling through to the pre-existing "uneditable" frozen-HTML
// treatment, exactly as it did before this issue. Independent-review-gate
// finding: an earlier revision of this change removed 'table' from
// UNEDITABLE_TAGS unconditionally, which would have silently reparsed every
// layout table in every quoted reply/forward, scrambling structure and
// dropping every table/cell HTML attribute.
// ---------------------------------------------------------------------------

describe('real-world layout table stays uneditable (not parsed as an editable table)', () => {
  it('keeps a deeply-nested layout table (email_16.html fixture) as a single uneditable block, not a TABLE_TYPE tree', () => {
    const fixturePath = path.resolve(__dirname, 'fixtures', 'emails', 'email_16.html');
    const html = fs.readFileSync(fixturePath, 'utf8');

    const value = convertFromHTML(html);

    const containsTableTypeNode = value.document
      .getBlocksAsArray()
      .some(
        (n) => n.type === TABLE_TYPE || n.type === TABLE_ROW_TYPE || n.type === TABLE_CELL_TYPE
      );
    expect(containsTableTypeNode).toBe(false);

    const containsUneditableNode = value.document
      .getBlocksAsArray()
      .some((n) => n.type === 'uneditable');
    expect(containsUneditableNode).toBe(true);
  });

  it('isSimpleTableElement rejects a table with a nested <table> inside a <td>', () => {
    const el = document.createElement('div');
    el.innerHTML = '<table><tr><td><table><tr><td>nested</td></tr></table></td></tr></table>';
    const outerTable = el.querySelector('table') as HTMLElement;
    expect(isSimpleTableElement(outerTable)).toBe(false);
  });

  it('isSimpleTableElement rejects a table with a block-level element (<div>) inside a <td>', () => {
    const el = document.createElement('div');
    el.innerHTML = '<table><tr><td><div>layout content</div></td></tr></table>';
    const outerTable = el.querySelector('table') as HTMLElement;
    expect(isSimpleTableElement(outerTable)).toBe(false);
  });

  it('isSimpleTableElement accepts a plain data table with only inline cell content', () => {
    const el = document.createElement('div');
    el.innerHTML = '<table><tr><td>Plain <b>text</b></td><td>More text</td></tr></table>';
    const outerTable = el.querySelector('table') as HTMLElement;
    expect(isSimpleTableElement(outerTable)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// insertTable: real-content seeding + correct sibling placement.
// ---------------------------------------------------------------------------

describe('insertTable', () => {
  it("seeds each cell with a real (empty-string) text node, places a trailing div as the table's own sibling, and lands the cursor in the first cell", () => {
    const initial: ValueJSON = {
      document: {
        object: 'document',
        nodes: [{ object: 'block', type: 'div', nodes: [textJSON('')] }],
      },
    };
    const editor = new Editor({ value: Value.fromJSON(initial), plugins: TablePlugins });

    insertTable(editor);

    const table = editor.value.document.nodes.find((n) => n.type === TABLE_TYPE) as Block;
    expect(table).toBeTruthy();
    expect(table.nodes.size).toBe(2);
    table.nodes.forEach((row) => {
      const rowBlock = row as Block;
      expect(rowBlock.type).toBe(TABLE_ROW_TYPE);
      expect(rowBlock.nodes.size).toBe(2);
      rowBlock.nodes.forEach((cell) => {
        const cellBlock = cell as Block;
        expect(cellBlock.type).toBe(TABLE_CELL_TYPE);
        expect(cellBlock.nodes.size).toBe(1);
        expect(cellBlock.nodes.get(0).object).toBe('text');
        expect(cellBlock.text).toBe('');
      });
    });

    // Trailing empty div must be the table's own next sibling, not a spurious extra
    // cell inside the table's last row.
    const tableIndex = editor.value.document.nodes.indexOf(table);
    const trailing = editor.value.document.nodes.get(tableIndex + 1) as Block;
    expect(trailing.type).toBe('div');

    const firstRow = table.nodes.get(0) as Block;
    const firstCell = firstRow.nodes.get(0) as Block;
    expect(editor.value.selection.start.key).toBe(firstCell.getFirstText().key);
  });
});
