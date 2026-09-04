import React from 'react';
import { Editor } from 'slate';
import { RetinaImg } from 'mailspring-component-kit';
import { localized, SanitizeTransformer } from 'mailspring-exports';
import { ComposerEditorPlugin } from './types';
import { isSimpleTableElement } from './table-plugins';

export const UNEDITABLE_TYPE = 'uneditable';
export const UNEDITABLE_TAGS = ['img', 'center', 'signature', 'table'];

function UneditableNode(props) {
  const { attributes, node, editor, targetIsHTML, isFocused, children } = props;
  const __html = node.data.get ? node.data.get('html') : node.data.html;

  if (targetIsHTML) {
    return <div dangerouslySetInnerHTML={{ __html }} />;
  }
  return (
    <div {...attributes} className={`uneditable custom-block ${isFocused && 'focused'}`}>
      <a
        className="uneditable-remove"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          editor.removeNodeByKey(node.key);
        }}
      >
        <RetinaImg
          title={localized('Remove HTML')}
          name="image-cancel-button.png"
          mode={RetinaImg.Mode.ContentPreserve}
        />
      </a>
      <div dangerouslySetInnerHTML={{ __html }} />
      {/* This node below is necessary for selection of the uneditable block, and
      we also put the text content of the HTML in so that copy/paste works nicely. */}
      <div style={{ position: 'absolute', height: 0, overflow: 'hidden' }}>{children}</div>
    </div>
  );
}

function renderNode(props, editor: Editor = null, next = () => {}) {
  if (props.node.type === UNEDITABLE_TYPE) {
    return UneditableNode(props);
  }
  return next();
}

const rules = [
  {
    deserialize(el: HTMLElement, next: (elements: NodeList) => any) {
      const tagName = el.tagName.toLowerCase();

      // A "simple" table (every cell's children are inline-level, no nested table) is a
      // data table this composer's editable table_cell model can represent faithfully --
      // let TablePlugins' own deserialize rule (registered later in
      // conversion.tsx#plugins) claim it instead. Everything else -- real-world layout
      // tables with block-level content nested in cells, routine in marketing/newsletter/
      // invoice HTML -- keeps the existing frozen-HTML "uneditable" treatment below, since
      // TABLE_SCHEMA's cell-as-leaf model would otherwise scramble their structure and
      // drop every table/cell HTML attribute (width, bgcolor, colspan, rowspan, style).
      if (tagName === 'table' && isSimpleTableElement(el)) {
        return undefined;
      }

      if (UNEDITABLE_TAGS.includes(tagName)) {
        // The captured HTML is later re-injected via dangerouslySetInnerHTML in
        // UneditableNode. Because this composer runs in a renderer with nodeIntegration,
        // any preserved <img onerror=...>, <iframe>, or <script> would execute with Node
        // access. Sanitize here so every input path (mailto, paste, drag-drop, programmatic)
        // is covered at the funnel.
        return {
          object: 'block',
          type: UNEDITABLE_TYPE,
          data: {
            html: SanitizeTransformer.runSync(el.outerHTML),
          },
          nodes: [],
        };
      }
    },
    serialize(obj: any, children: any) {
      if (obj.object !== 'block') return;
      return renderNode({ node: obj, children, targetIsHTML: true });
    },
  },
];

const plugins: ComposerEditorPlugin[] = [
  {
    renderNode,
    rules,
  },
];

export default plugins;
